#!/usr/bin/env bash
# Checks the connector front door end to end, MCP and its REST mirror: a request with no key is
# refused, the account key is accepted, the one tool is listed, get_status answers, and
# GET /api/connector/status answers the same. The key is read from .env and handed to curl on
# stdin, so it never appears in the command line or the output.
#
#   ./scripts/mcp-smoke.sh                                   production (www), account a
#   ./scripts/mcp-smoke.sh https://www.musefriends.tech b
#   ./scripts/mcp-smoke.sh http://localhost:3003 a           local dev server
#
# Use the www address, not the bare name: the bare name answers with a 308 redirect, and a client
# that does not follow a redirect on a POST would fail there.
set -euo pipefail

cd "$(dirname "$0")/.."

base_url="${1:-https://www.musefriends.tech}"
account="${2:-a}"
key_name="MCP_TOKEN_$(printf '%s' "$account" | tr '[:lower:]' '[:upper:]')"
endpoint="$base_url/api/mcp"
rest_endpoint="$base_url/api/connector/status"

token="$(awk -v key="$key_name" 'index($0, key "=") == 1 { value = substr($0, length(key) + 2) } END { printf "%s", value }' .env 2> /dev/null || true)"
if [ -z "$token" ]; then
  echo "$key_name is not set in .env" >&2
  exit 1
fi

body_file="$(mktemp)"
trap 'rm -f "$body_file"' EXIT

failures=0
check() {
  if [ "$2" = "ok" ]; then echo "PASS  $1"; else echo "FAIL  $1: $3"; failures=$((failures + 1)); fi
}

post() {
  local with_key="$1" payload="$2"
  if [ "$with_key" = "yes" ]; then
    printf 'header = "Authorization: Bearer %s"\n' "$token" | curl -sS -m 30 -K - -o "$body_file" -w '%{http_code}' \
      -X POST "$endpoint" -H 'content-type: application/json' -H 'accept: application/json, text/event-stream' -d "$payload"
  else
    curl -sS -m 30 -o "$body_file" -w '%{http_code}' \
      -X POST "$endpoint" -H 'content-type: application/json' -H 'accept: application/json, text/event-stream' -d "$payload"
  fi
}

list_tools='{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
call_status='{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"get_status","arguments":{}}}'

status="$(post no "$list_tools")"
if [ "$status" = "401" ]; then check "no key is refused" ok; else check "no key is refused" bad "got HTTP $status"; fi

status="$(post yes "$list_tools")"
if [ "$status" = "200" ] && grep -q '"get_status"' "$body_file"; then
  check "key $key_name is accepted and get_status is listed" ok
else
  check "key $key_name is accepted and get_status is listed" bad "got HTTP $status"
fi

status="$(post yes "$call_status")"
if [ "$status" = "200" ] && grep -q 'muse-friends' "$body_file"; then
  check "get_status answers" ok
  sed -n 's/^data: //p' "$body_file" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{console.log(JSON.parse(s).result.content[0].text)}catch{console.log("(could not parse the reply)")}})' |
    sed 's/^/      /'
else
  check "get_status answers" bad "got HTTP $status"
fi

get_rest() {
  local with_key="$1"
  if [ "$with_key" = "yes" ]; then
    printf 'header = "Authorization: Bearer %s"\n' "$token" | curl -sS -m 30 -K - -o "$body_file" -w '%{http_code}' "$rest_endpoint"
  else
    curl -sS -m 30 -o "$body_file" -w '%{http_code}' "$rest_endpoint"
  fi
}

status="$(get_rest no)"
if [ "$status" = "401" ]; then check "REST mirror: no key is refused" ok; else check "REST mirror: no key is refused" bad "got HTTP $status"; fi

status="$(get_rest yes)"
if [ "$status" = "200" ] && grep -q '"service":"muse-friends"' "$body_file"; then
  check "REST mirror: key $key_name is accepted and status answers" ok
else
  check "REST mirror: key $key_name is accepted and status answers" bad "got HTTP $status"
fi

if [ "$failures" -gt 0 ]; then
  echo "$failures check(s) failed."
  exit 1
fi
echo "all checks passed."
