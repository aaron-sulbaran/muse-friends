#!/usr/bin/env bash
# The scriptable half of smoke test 7: the production URL answers with no login wall, fast, and
# serves what a judge's phone needs. Run it from any network (venue Wi-Fi, a phone hotspot).
# The negotiation itself is run by hand on a phone; see "Smoke test 7" in docs/RUNBOOK.md.
#
#   ./scripts/smoke-production.sh                          https://muse-friends.vercel.app
#   ./scripts/smoke-production.sh http://localhost:3003    a local dev server
set -uo pipefail

base_url="${1:-https://muse-friends.vercel.app}"
slow_seconds=3

failures=0
pass() { echo "PASS  $1"; }
fail() { echo "FAIL  $1: $2"; failures=$((failures + 1)); }

# fetch PATH: sets status, seconds, final_url, content_type, and body_file.
body_file="$(mktemp)"
trap 'rm -f "$body_file"' EXIT
fetch() {
  local line
  line="$(curl -sS -L -m 20 -o "$body_file" -w '%{http_code} %{time_total} %{url_effective} %{content_type}' "$base_url$1" 2> /dev/null)" || line="000 0 - -"
  read -r status seconds final_url content_type <<< "$line"
}

expect_page() {
  local path="$1" label="$2"
  fetch "$path"
  if [ "$status" != "200" ]; then
    fail "$label" "HTTP $status"
  elif [[ "$final_url" == *vercel.com* ]]; then
    fail "$label" "redirected to a Vercel login ($final_url)"
  elif awk -v s="$seconds" -v max="$slow_seconds" 'BEGIN { exit !(s > max) }'; then
    fail "$label" "answered in ${seconds}s, over ${slow_seconds}s"
  else
    pass "$label (${seconds}s)"
  fi
}

fetch /api/health
if [ "$status" = "200" ] && [[ "$final_url" != *vercel.com* ]] && grep -q '"ok":true' "$body_file"; then
  pass "health answers ok, commit $(sed -n 's/.*"sha":"\([^"]*\)".*/\1/p' "$body_file") (${seconds}s)"
else
  fail "health answers ok" "HTTP $status, $final_url"
fi

expect_page / "home page loads with no login"
expect_page /a "phone A loads"
expect_page /b "phone B loads"

fetch /qr.svg
if [ "$status" = "200" ] && [[ "$content_type" == image/svg+xml* ]]; then pass "QR code is served as an SVG"; else fail "QR code is served as an SVG" "HTTP $status, $content_type"; fi

fetch /api/state
if [ "$status" = "200" ] && node -e 'JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"))' "$body_file" 2> /dev/null; then
  pass "state answers with JSON (${seconds}s)"
else
  fail "state answers with JSON" "HTTP $status"
fi

if [ "$failures" -gt 0 ]; then
  echo "$failures check(s) failed."
  exit 1
fi
echo "all checks passed."
