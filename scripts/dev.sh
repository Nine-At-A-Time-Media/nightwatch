#!/usr/bin/env bash
# dev.sh -- `pnpm dev`: run Nightwatch's Workers on the local Wrangler
# runtime (architecture, Local development).
#
# Usage: pnpm dev [extra wrangler dev arguments...]
#
# Always `wrangler dev --local`; no Cloudflare account is read. Local state
# (Durable Objects, R2, KV) persists under .wrangler/state; wrangler's own
# config and logs live under .state/ (see scripts/wrangler.sh). Each Worker's
# config is passed with its own -c, so bindings between them resolve locally.

set -euo pipefail

readonly WORKER_CONFIGS=(
  "src/workers/ingest/wrangler.jsonc"
  "src/workers/core/wrangler.jsonc"
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
  exec "${here}/wrangler.sh" dev --local "${arguments[@]}" "$@"
}

main "$@"
