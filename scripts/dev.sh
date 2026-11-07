#!/usr/bin/env bash
# dev.sh -- `pnpm dev`: run Nightwatch's Workers on the local Wrangler
# runtime (architecture, Local development).
#
# Usage: pnpm dev [extra wrangler dev arguments...]
#
# Always `wrangler dev --local`; no Cloudflare account is read. The first
# config (ingest) serves HTTP; core and processor run beside it. D1
# migrations are applied first. Local state (Durable Objects, D1, R2, KV)
# persists under .wrangler/state at the repository root; wrangler's own
# config and logs live under .state/ (see scripts/wrangler.sh). Each Worker's
# config is passed with its own -c, so bindings between them resolve locally.
# Crons do not fire in a local session: run `pnpm dev:tick` once to kick the
# processor's pumps; each then re-arms its own alarm.

set -euo pipefail

readonly WORKER_CONFIGS=(
  "src/workers/ingest/wrangler.jsonc"
  "src/workers/core/wrangler.jsonc"
  "src/workers/processor/wrangler.jsonc"
)

# Every Worker's local state in one place, so D1, R2 and Durable Objects are
# shared across the session and `wrangler d1 execute --local` sees them.
# NIGHTWATCH_PERSIST_TO overrides it (the end-to-end script uses a fresh one).
readonly PERSIST_TO="${NIGHTWATCH_PERSIST_TO:-.wrangler/state}"

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
  "${here}/wrangler.sh" d1 migrations apply CONTROL --local --persist-to "${PERSIST_TO}" \
    -c "${WORKER_CONFIGS[0]}" >&2
  exec "${here}/wrangler.sh" dev --local --persist-to "${PERSIST_TO}" "${arguments[@]}" "$@"
}

main "$@"
