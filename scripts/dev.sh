#!/usr/bin/env bash
# dev.sh -- `pnpm dev`: run Nightwatch's Workers on the local Wrangler
# runtime (architecture, Local development).
#
# Usage: pnpm dev [extra wrangler dev arguments...]
#
# Always `wrangler dev --local`; no Cloudflare account is read. Local state
# (Durable Objects, D1, R2, KV) persists under .wrangler/state; wrangler's own
# config and logs live under .state/ (see scripts/wrangler.sh). Each Worker's
# config is passed with its own -c, so bindings between them resolve locally.
# The control-plane D1 migrations are applied to the local database first;
# applying them again changes nothing. Cron Triggers do not fire on their own
# locally: `pnpm dev:tick` fires the scheduler's (scripts/dev-tick.sh).

set -euo pipefail

readonly STATE_DIR=".wrangler/state"
readonly CONTROL_DATABASE="nightwatch-control"
readonly CONTROL_CONFIG="src/workers/scheduler/wrangler.jsonc"
readonly WORKER_CONFIGS=(
  "src/workers/ingest/wrangler.jsonc"
  "src/workers/core/wrangler.jsonc"
  "src/workers/monitors/wrangler.jsonc"
  "src/workers/scheduler/wrangler.jsonc"
)

# --- helpers ---

config_arguments() {
  local config
  for config in "${WORKER_CONFIGS[@]}"; do
    printf -- '-c\n%s\n' "${config}"
  done
}

# --- main ---

main() {
  local here arguments
  here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
  readarray -t arguments < <(config_arguments)
  "${here}/wrangler.sh" d1 migrations apply "${CONTROL_DATABASE}" --local --persist-to "${STATE_DIR}" -c "${CONTROL_CONFIG}"
  exec "${here}/wrangler.sh" dev --local --persist-to "${STATE_DIR}" "${arguments[@]}" "$@"
}

main "$@"
