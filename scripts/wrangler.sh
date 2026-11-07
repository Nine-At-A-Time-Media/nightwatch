#!/usr/bin/env bash
# wrangler.sh -- run the repository's pinned wrangler with its state kept in
# the checkout (architecture, Local development; coding skill, project-local
# tool state).
#
# Usage: scripts/wrangler.sh <wrangler arguments...>
#
# XDG_CONFIG_HOME and WRANGLER_LOG_PATH point under .state/ for this process
# only. No Cloudflare account is read: the API token and account id are
# removed from the environment, and `login` is refused.

set -euo pipefail

# --- helpers ---

repo_root() {
  cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd
}

refuse_login() {
  local command="${1:-}"
  if [[ "${command}" == "login" ]]; then
    echo "wrangler.sh: never run 'wrangler login' in this repository; the local stage needs no account." >&2
    exit 64
  fi
}

# --- main ---

main() {
  refuse_login "$@"
  local root
  root="$(repo_root)"
  mkdir -p "${root}/.state/xdg" "${root}/.state/wrangler-logs"
  cd "${root}"
  exec env -u CLOUDFLARE_API_TOKEN -u CLOUDFLARE_ACCOUNT_ID \
    XDG_CONFIG_HOME="${root}/.state/xdg" \
    WRANGLER_LOG_PATH="${root}/.state/wrangler-logs" \
    WRANGLER_SEND_METRICS=false \
    "${root}/node_modules/.bin/wrangler" "$@"
}

main "$@"
