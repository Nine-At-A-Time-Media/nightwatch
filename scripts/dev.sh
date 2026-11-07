#!/usr/bin/env bash
# dev.sh -- `pnpm dev`: run Nightwatch's Workers on the local Wrangler
# runtime (architecture, Local development).
#
# Usage: pnpm dev [extra wrangler dev arguments...]
#
# Always `wrangler dev --local`; no Cloudflare account is read. Local state
# (Durable Objects, R2, KV) persists under .wrangler/state; wrangler's own
# config and logs live under .state/ (see scripts/wrangler.sh). Each Worker's
# config is passed with its own -c, so bindings between them resolve locally;
# the local fake GitHub (dev/fake-github) runs beside them. Worker secrets are
# written to each Worker's .dev.vars on the first run (scripts/dev-vars.sh).

set -euo pipefail

readonly WORKER_CONFIGS=(
  "src/workers/ingest/wrangler.jsonc"
  "src/workers/core/wrangler.jsonc"
  "src/workers/notifier/wrangler.jsonc"
  "src/workers/github/wrangler.jsonc"
  "src/workers/inbound-mail/wrangler.jsonc"
  "dev/fake-github/wrangler.jsonc"
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
  "${here}/dev-vars.sh"
  readarray -t arguments < <(config_arguments)
  exec "${here}/wrangler.sh" dev --local "${arguments[@]}" "$@"
}

main "$@"
