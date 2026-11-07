#!/usr/bin/env bash
# e2e-local.sh -- `pnpm test:e2e`: the local pipeline end to end, from an SDK
# envelope to an Issue, on `wrangler dev --local` with the ingest, core and
# processor Workers in one session (scripts/dev.sh). Cross-script Durable
# Object bindings (the processor reaching LogDO in ingest and ProjectDO in
# core) need every Worker running, which one Vitest project cannot host, so
# this runs against the real dev session instead of under `pnpm check`.
#
# Usage: pnpm test:e2e        (E2E_PORT overrides the port, default 8797)
#
# Prerequisites: pnpm install; curl and node on PATH. No Cloudflare account.
# Side effects: starts and stops a dev session; its state lives in a fresh
# .state/e2e directory, removed before each run.
#
# Steps: seed D1 (Organization, Project, Client Key config, processing
# config) through Wrangler's local explorer API; POST an error envelope to
# ingest; fire the processor's Cron Trigger, which kicks the pumps; read the
# Project's ProjectDO storage. Then: the same crash again counts 2 on the same
# Issue, a different crash opens a second Issue, and a duplicate Event id
# changes nothing.

set -euo pipefail

readonly PORT="${E2E_PORT:-8797}"
readonly BASE="http://localhost:${PORT}"
readonly EXPLORER="${BASE}/cdn-cgi/local/explorer/api"
readonly PERSIST_TO=".state/e2e"
readonly PROJECT="e2e-project"
readonly KEY="e2e-key"
readonly WAIT_SECONDS=30

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
readonly ROOT
DEV_PID=""

# --- helpers: the dev session ---

start_dev() {
  rm -rf "${ROOT:?}/${PERSIST_TO}"
  mkdir -p "${ROOT}/${PERSIST_TO}"
  echo "e2e: starting the dev session on port ${PORT}" >&2
  # Job control puts the session in a process group of its own, so stop_dev
  # can end wrangler and every workerd it started (setsid is not on macOS).
  set -m
  NIGHTWATCH_PERSIST_TO="${PERSIST_TO}" "${ROOT}/scripts/dev.sh" --port "${PORT}" \
    >"${ROOT}/${PERSIST_TO}/dev.log" 2>&1 &
  DEV_PID=$!
  set +m
}

stop_dev() {
  if [[ -n "${DEV_PID}" ]]; then
    kill -- "-${DEV_PID}" 2>/dev/null || true
    wait "${DEV_PID}" 2>/dev/null || true
  fi
}

wait_ready() {
  local waited=0
  until curl -sf -o /dev/null "${EXPLORER}/local/workers"; do
    if ((waited >= WAIT_SECONDS * 4)); then
      echo "e2e: the dev session did not start; see ${PERSIST_TO}/dev.log" >&2
      return 1
    fi
    sleep 0.25
    waited=$((waited + 1))
  done
}

# --- helpers: HTTP ---

explorer_post() {
  local path="$1" body="$2"
  curl -sf -X POST "${EXPLORER}${path}" -H 'content-type: application/json' --data-binary "${body}"
}

# Prints one value from JSON on stdin, by a JavaScript expression over `d`.
json_value() {
  local expression="$1"
  node -e "let s='';process.stdin.on('data',c=>s+=c).on('end',()=>{const d=JSON.parse(s);console.log(${expression})})"
}

d1_execute() {
  local sql="$1"
  explorer_post "/d1/database/nightwatch-control-local/raw" "$(node -e 'console.log(JSON.stringify({sql: process.argv[1]}))' "${sql}")" >/dev/null
}

# --- helpers: the scenario ---

seed_control_plane() {
  local config processing
  config='{"clientKeys":[{"publicKey":"'"${KEY}"'","active":true}],"allowedOrigins":["*"],"sizeLimits":{"event":1000000,"attachment":1000000,"arrival":2000000},"inboundFilters":{"browserExtensions":false,"localhost":false,"webCrawlers":false,"releases":[],"messages":[],"addresses":[]}}'
  processing='{"scrubbing":{"ipAddresses":false,"project":[]},"grouping":{"version":{"id":"gv1","contextLineMaxLength":120},"fingerprintRules":[],"stackTraceRules":[]},"eventRetentionMs":7776000000}'
  echo "e2e: seeding D1 with Project ${PROJECT}" >&2
  d1_execute "INSERT INTO organizations (organization_id) VALUES ('e2e-org')"
  d1_execute "INSERT INTO projects (project_id, organization_id) VALUES ('${PROJECT}', 'e2e-org')"
  d1_execute "INSERT INTO project_configs (project_id, config) VALUES ('${PROJECT}', '${config}')"
  d1_execute "INSERT INTO processing_configs (project_id, config) VALUES ('${PROJECT}', '${processing}')"
}

# An envelope carrying one error event: event id, exception type and value.
envelope() {
  local event_id="$1" type="$2" value="$3" now
  now="$(date +%s)"
  printf '{"event_id":"%s"}\n{"type":"event"}\n{"event_id":"%s","timestamp":%s,"platform":"python","level":"error","exception":{"values":[{"type":"%s","value":"%s","stacktrace":{"frames":[{"function":"charge","module":"billing","filename":"billing.py","lineno":42,"in_app":true}]}}]}}\n' \
    "${event_id}" "${event_id}" "${now}" "${type}" "${value}"
}

post_event() {
  local event_id="$1" type="$2" value="$3" status
  status="$(envelope "${event_id}" "${type}" "${value}" |
    curl -s -o /dev/null -w '%{http_code}' -X POST --data-binary @- \
      "${BASE}/api/${PROJECT}/envelope/?sentry_key=${KEY}&sentry_version=7")"
  if [[ "${status}" != "200" ]]; then
    echo "e2e: ingest answered ${status} for event ${event_id}" >&2
    return 1
  fi
}

# Fires the processor's Cron Trigger until its handler completes; right after
# the session starts, the processor Worker can still refuse it.
kick_pumps() {
  local outcome="" waited=0
  while ((waited < WAIT_SECONDS * 4)); do
    outcome="$(explorer_post "/local/scheduled?worker=nightwatch-processor" '{"cron":"* * * * *"}' |
      json_value 'd.result?.outcome' || true)"
    if [[ "${outcome}" == "ok" ]]; then
      echo "e2e: pumps kicked" >&2
      return 0
    fi
    sleep 0.25
    waited=$((waited + 1))
  done
  echo "e2e: FAILED -- the processor's scheduled handler kept answering '${outcome}'" >&2
  return 1
}

# Prints the Project's Issues as "count count ..." in the order they opened.
issue_counts() {
  local body
  body="$(node -e 'console.log(JSON.stringify({durable_object_name: process.argv[1], queries: [{sql: "SELECT state FROM issues ORDER BY seq"}]}))' "${PROJECT}")"
  explorer_post "/workers/durable_objects/namespaces/nightwatch-core-ProjectDO/query" "${body}" 2>/dev/null |
    json_value "(d.result?.[0]?.rows ?? []).map(([state]) => JSON.parse(state).count).join(' ')" || true
}

# Prints the dev session's failed spans, for a failure report.
failed_spans() {
  explorer_post "/local/observability/query" \
    "{\"sql\":\"SELECT service, name, error FROM spans WHERE outcome != 'ok' ORDER BY start_ms LIMIT 20\"}" || true
}

# Waits until the Project's Issue counts read as expected.
expect_counts() {
  local expected="$1" what="$2" actual="" waited=0
  while ((waited < WAIT_SECONDS * 4)); do
    actual="$(issue_counts)"
    if [[ "${actual}" == "${expected}" ]]; then
      echo "e2e: ok -- ${what} (Issue counts: ${actual})" >&2
      return 0
    fi
    sleep 0.25
    waited=$((waited + 1))
  done
  echo "e2e: FAILED -- ${what}: expected Issue counts '${expected}', got '${actual}'; see ${PERSIST_TO}/dev.log" >&2
  echo "e2e: failed spans: $(failed_spans)" >&2
  return 1
}

# Holds the counts for a few pump intervals, so a late change is caught.
expect_counts_stay() {
  local expected="$1" what="$2"
  sleep 3
  expect_counts "${expected}" "${what}"
}

# --- main ---

main() {
  cd "${ROOT}"
  trap stop_dev EXIT
  start_dev
  wait_ready
  seed_control_plane

  post_event "11111111111111111111111111111111" "PaymentError" "card declined"
  kick_pumps
  expect_counts "1" "a first error opens one Issue with count 1"

  post_event "22222222222222222222222222222222" "PaymentError" "card declined"
  expect_counts "2" "the same crash again counts 2 on the same Issue"

  post_event "33333333333333333333333333333333" "TimeoutError" "gateway timed out"
  expect_counts "2 1" "a different crash opens a second Issue"

  post_event "33333333333333333333333333333333" "TimeoutError" "gateway timed out"
  expect_counts_stay "2 1" "a duplicate Event id changes nothing"

  echo "e2e: passed" >&2
}

main "$@"
