#!/usr/bin/env bash
# dev-tick.sh -- `pnpm dev:tick`: fire the scheduler Worker's Cron Trigger in
# a running `pnpm dev` session (architecture, Local development: Cron
# Triggers are called by tests and by this). Cron Triggers never fire on
# their own locally.
#
# Usage: pnpm dev:tick [port]
#
# The scheduler is not the session's primary Worker, so the trigger goes
# through the local explorer's scheduled route, which names the Worker.
# Prints the outcome; exits non-zero when the handler threw.

set -euo pipefail

readonly DEFAULT_PORT=8787
readonly WORKER="nightwatch-scheduler"
readonly CRON="17 3 * * *"

# --- main ---

main() {
  local port="${1:-${DEFAULT_PORT}}" answer
  answer="$(curl --silent --show-error --fail -X POST \
    "http://localhost:${port}/cdn-cgi/local/explorer/api/local/scheduled?worker=${WORKER}" \
    -H 'content-type: application/json' \
    -d "{\"cron\":\"${CRON}\"}")"
  echo "${answer}"
  [[ "${answer}" == *'"outcome":"ok"'* ]]
}

main "$@"
