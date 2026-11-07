#!/usr/bin/env bash
# dev-tick.sh -- `pnpm dev:tick`: fire the Cron Triggers of a running
# `pnpm dev` session (architecture, Local development: Cron Triggers are
# called by tests and by this). Cron Triggers never fire on their own locally.
# The processor's cron kicks the pumps; the scheduler's runs retention and
# usage.
#
# Usage: pnpm dev:tick [port]
#
# Neither Worker is the session's primary, so each trigger goes through the
# local explorer's scheduled route, which names the Worker. Prints each
# outcome; exits non-zero when a handler threw.

set -euo pipefail

readonly DEFAULT_PORT=8787
# Each Worker with a Cron Trigger, and a cron it answers to.
readonly TICKS=("nightwatch-processor|* * * * *" "nightwatch-scheduler|17 3 * * *")

# --- helpers ---

tick() {
  local port="$1" worker="$2" cron="$3" answer
  answer="$(curl --silent --show-error --fail -X POST \
    "http://localhost:${port}/cdn-cgi/local/explorer/api/local/scheduled?worker=${worker}" \
    -H 'content-type: application/json' \
    -d "{\"cron\":\"${cron}\"}")"
  echo "${worker}: ${answer}"
  [[ "${answer}" == *'"outcome":"ok"'* ]]
}

# --- main ---

main() {
  local port="${1:-${DEFAULT_PORT}}" entry
  for entry in "${TICKS[@]}"; do
    tick "${port}" "${entry%%|*}" "${entry#*|}"
  done
}

if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then
  main "$@"
fi
