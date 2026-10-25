#!/usr/bin/env bash
# Copies the server-side settings from the local .env into the linked Vercel project, for the
# Production and Preview environments. Secrets are stored as Sensitive. Values are piped to the
# Vercel CLI and never printed; the output shows names and lengths only.
#
#   ./scripts/push-env-to-vercel.sh                    push everything that is set in .env
#   ./scripts/push-env-to-vercel.sh --dry-run          show what would be pushed, change nothing
#   ./scripts/push-env-to-vercel.sh --with-mcp-tokens  first generate MCP_TOKEN_A and MCP_TOKEN_B
#                                                      into .env if they are missing, then push
#
# Safe to re-run: it overwrites the same variables. Environment variables only reach deployments made
# after the push, so redeploy afterwards (Deployments, the latest production deployment, Redeploy).
set -euo pipefail

cd "$(dirname "$0")/.."

dry_run=false
with_mcp_tokens=false
for argument in "$@"; do
  case "$argument" in
    --dry-run) dry_run=true ;;
    --with-mcp-tokens) with_mcp_tokens=true ;;
    *) echo "unknown option: $argument" >&2; exit 1 ;;
  esac
done

env_file=".env"
if [ ! -f "$env_file" ]; then
  echo "No $env_file in $(pwd). Run this from the code checkout that holds it." >&2
  exit 1
fi

read_value() {
  local value
  value="$(awk -v key="$1" 'index($0, key "=") == 1 { value = substr($0, length(key) + 2) } END { printf "%s", value }' "$env_file")"
  value="${value%\"}"
  value="${value#\"}"
  printf '%s' "$value"
}

ensure_token() {
  if [ -n "$(read_value "$1")" ]; then return; fi
  if $dry_run; then
    echo "would generate $1 into $env_file"
    return
  fi
  if [ -n "$(tail -c1 "$env_file")" ]; then echo >> "$env_file"; fi
  echo "$1=$(openssl rand -hex 24)" >> "$env_file"
  echo "generated $1 into $env_file"
}

send() {
  local name="$1" kind="$2" value="$3" flag
  if $dry_run; then
    echo "would push $name (${#value} characters, $kind)"
    return
  fi
  if [ "$kind" = "secret" ]; then flag="--sensitive"; else flag="--no-sensitive"; fi
  printf '%s' "$value" | vercel env add "$name" --environment production,preview "$flag" --force --yes > /dev/null
  echo "pushed $name (${#value} characters, $kind)"
}

push() {
  local name="$1" kind="$2" value
  value="$(read_value "$name")"
  if [ -z "$value" ]; then
    echo "skipped $name (not set in $env_file)"
    return
  fi
  send "$name" "$kind" "$value"
}

if [ -z "$(read_value MODEL_API_KEY)" ]; then
  echo "MODEL_API_KEY is not set in $env_file; set it first." >&2
  exit 1
fi

if ! $dry_run && [ ! -f .vercel/project.json ]; then
  vercel link --yes --project muse-friends --scope aaron-sulbaran-projects
fi

if $with_mcp_tokens; then
  ensure_token MCP_TOKEN_A
  ensure_token MCP_TOKEN_B
fi

push MODEL_API_KEY secret
push MCP_TOKEN_A secret
push MCP_TOKEN_B secret
push SUPABASE_SERVICE_ROLE_KEY secret
push SUPABASE_URL config

# Production reads the Supabase store; local development leaves STORE unset and uses the JSON file.
# So STORE is set here, in Vercel only, and never read from .env.
if [ -n "$(read_value SUPABASE_URL)" ] && [ -n "$(read_value SUPABASE_SERVICE_ROLE_KEY)" ]; then
  send STORE config supabase
fi

if $dry_run; then
  echo "dry run only; nothing was changed."
else
  echo "done. Redeploy the production deployment so it picks these up."
fi
