#!/usr/bin/env bash
# Runs one "bring your own Muse" plan end to end over the REST mirror: closed without the right key,
# bad windows refused, start_plan, check_plan until the agents agree, respond, and a check that the
# demo room's content did not change. The judge key is read from .env and handed to curl on stdin, so it
# never appears in the command line or the output.
#
#   ./scripts/byom-smoke.sh http://localhost:3003            local dev server (STORE unset, JSON store)
#   ./scripts/byom-smoke.sh https://www.musefriends.tech     production: creates one plan room in that
#                                                            deployment's byom_rooms table (never the
#                                                            demo room) and spends about 3 model calls
#
# Needs MCP_TOKEN_JUDGE in .env (the same value the server has). The window is Thu Oct 29, 7 to 9pm, which
# the fictional friend Mochi shares; after Oct 28 it falls outside the "next 7 days" rule, so edit it.
# Use the www address for production: the bare name answers with a 308 redirect.
set -uo pipefail

cd "$(dirname "$0")/.."

base_url="${1:?usage: byom-smoke.sh <base url>}"
base_url="${base_url%/}"
token="$(awk 'index($0, "MCP_TOKEN_JUDGE=") == 1 { value = substr($0, length("MCP_TOKEN_JUDGE=") + 1) } END { printf "%s", value }' .env 2> /dev/null || true)"
team_token="$(awk 'index($0, "MCP_TOKEN_A=") == 1 { value = substr($0, length("MCP_TOKEN_A=") + 1) } END { printf "%s", value }' .env 2> /dev/null || true)"
if [ -z "$token" ]; then
  echo "MCP_TOKEN_JUDGE is not set in .env" >&2
  exit 1
fi

window='{"free_windows":[{"day":"2026-10-29","start":"19:00","end":"21:00"}]}'
body_file="$(mktemp)"
trap 'rm -f "$body_file"' EXIT

failures=0
check() {
  if [ "$2" = "ok" ]; then echo "PASS  $1"; else echo "FAIL  $1: $3"; failures=$((failures + 1)); fi
}

# call <key or none> <METHOD> <path> [json body]; prints the HTTP status, leaves the body in $body_file.
call() {
  local key="$1" method="$2" path="$3" payload="${4:-}"
  local args=(-sS -m 90 -o "$body_file" -w '%{http_code}' -X "$method" "$base_url$path")
  [ -n "$payload" ] && args+=(-H 'content-type: application/json' -d "$payload")
  if [ "$key" = "none" ]; then
    curl "${args[@]}" 2> /dev/null || echo 000
  else
    printf 'header = "Authorization: Bearer %s"\n' "$key" | curl -K - "${args[@]}" 2> /dev/null || echo 000
  fi
}

# pick <dotted path>: a field from the last response body, "" when absent.
pick() {
  node -e 'const fs=require("fs");try{const j=JSON.parse(fs.readFileSync(process.argv[1],"utf8"));const v=process.argv[2].split(".").reduce((o,k)=>o==null?o:o[k],j);console.log(v==null?"":typeof v==="object"?JSON.stringify(v):v)}catch{console.log("")}' "$body_file" "$1"
}

# The demo room's content, not its run counters: those are shared with every other room on purpose.
demo_fingerprint() {
  curl -s -m 20 "$base_url/api/state" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{const j=JSON.parse(s);const keep={messages:j.messages,notes:j.notes,plan:j.plan,followThrough:j.followThrough,inFlight:j.inFlight,reel:j.reel,failure:j.failure,simulatedFriend:j.simulatedFriend,roomRunsUsed:j.budget&&j.budget.room.used};console.log(require("crypto").createHash("sha256").update(JSON.stringify(keep)).digest("hex").slice(0,16))}catch{console.log("unreadable")}})'
}

before="$(demo_fingerprint)"

status="$(call none POST /api/connector/start_plan "$window")"
[ "$status" = "401" ] && check "start_plan without a key is refused (401)" ok || check "start_plan without a key is refused (401)" fail "got $status"

if [ -n "$team_token" ]; then
  status="$(call "$team_token" POST /api/connector/start_plan "$window")"
  [ "$status" = "403" ] && check "a team key cannot start a plan (403)" ok || check "a team key cannot start a plan (403)" fail "got $status"
fi

status="$(call "$token" POST /api/connector/start_plan '{"free_windows":[{"day":"2026-10-26","start":"18:00","end":"19:00"},{"day":"2026-10-27","start":"18:00","end":"19:00"},{"day":"2026-10-28","start":"18:00","end":"19:00"},{"day":"2026-10-29","start":"18:00","end":"19:00"}]}')"
[ "$status" = "400" ] && check "four windows are refused (400) before any model call" ok || check "four windows are refused (400) before any model call" fail "got $status"

status="$(call "$token" POST /api/connector/start_plan "$window")"
plan_id="$(pick data.planId)"
if [ "$status" = "202" ] && [ -n "$plan_id" ]; then
  check "start_plan accepted (202) with a plan id" ok
else
  check "start_plan accepted (202) with a plan id" fail "got $status: $(head -c 300 "$body_file")"
  exit 1
fi

status="$(call "$token" GET "/api/connector/check_plan?planId=room_does_not_exist")"
[ "$status" = "404" ] && check "check_plan on an unknown plan is 404" ok || check "check_plan on an unknown plan is 404" fail "got $status"

state=""
for _ in $(seq 1 40); do
  sleep 3
  status="$(call "$token" GET "/api/connector/check_plan?planId=$plan_id")"
  state="$(pick data.state)"
  case "$state" in awaiting_you | dropped | stalled | confirmed) break ;; esac
done
messages="$(pick data.messages | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{console.log(JSON.parse(s).length)}catch{console.log(0)}})')"
if [ "$state" = "awaiting_you" ] && [ "${messages:-0}" -ge 2 ]; then
  check "the agents agreed: awaiting_you after $messages messages, with a drafted WhatsApp text" ok
else
  check "the agents agreed" fail "state=$state messages=$messages"
fi
[ -n "$(pick data.whatsapp_draft)" ] && check "check_plan carries the drafted message" ok || check "check_plan carries the drafted message" fail "no draft"

status="$(call "$token" POST /api/connector/respond "{\"planId\":\"$plan_id\",\"decision\":\"accept\"}")"
if [ "$status" = "200" ] && [ "$(pick data.state)" = "confirmed" ]; then
  check "respond accept confirms the plan" ok
else
  check "respond accept confirms the plan" fail "status=$status state=$(pick data.state)"
fi

status="$(call "$token" POST /api/connector/respond "{\"planId\":\"$plan_id\",\"decision\":\"accept\"}")"
[ "$status" = "409" ] && check "a second respond is refused (409)" ok || check "a second respond is refused (409)" fail "got $status"

after="$(demo_fingerprint)"
[ "$before" = "$after" ] && [ "$before" != "unreadable" ] && check "the demo room's content is unchanged" ok || check "the demo room's content is unchanged" fail "before=$before after=$after"

if [ "$failures" -eq 0 ]; then
  echo "all checks passed."
else
  echo "$failures check(s) failed."
  exit 1
fi
