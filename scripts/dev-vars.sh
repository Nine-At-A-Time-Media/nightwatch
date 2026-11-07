#!/usr/bin/env bash
# dev-vars.sh -- write the local stage's Worker secrets (.dev.vars beside each
# Worker's wrangler.jsonc) the first time `pnpm dev` runs in a checkout.
#
# Usage: scripts/dev-vars.sh
#
# One set of secrets is generated per checkout and kept under
# .state/dev-secrets/ (gitignored): a GitHub App key the notifier signs App
# JWTs with and the fake GitHub checks them against, the webhook secret the
# fake GitHub signs with and the github Worker verifies, and the Reply Token
# secret the notifier signs with and inbound-mail verifies. A .dev.vars that
# already exists is left alone. Nothing here is a real credential.

set -euo pipefail

readonly SECRETS_DIR=".state/dev-secrets"

# --- helpers ---

repo_root() {
  cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd
}

generate_secrets() {
  mkdir -p "${SECRETS_DIR}"
  node -e "
    const { generateKeyPairSync, randomBytes } = require('node:crypto');
    const { writeFileSync } = require('node:fs');
    const key = generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey.export({ type: 'pkcs8', format: 'pem' });
    writeFileSync('${SECRETS_DIR}/github-app-key.pem', key, { mode: 0o600 });
    writeFileSync('${SECRETS_DIR}/webhook-secret', randomBytes(32).toString('hex'), { mode: 0o600 });
    writeFileSync('${SECRETS_DIR}/reply-token-secret', randomBytes(32).toString('hex'), { mode: 0o600 });
  "
}

secret_line() {
  local name="$1" file="$2"
  printf '%s="%s"\n' "${name}" "$(cat "${SECRETS_DIR}/${file}")"
}

write_dev_vars() {
  local file="$1"
  shift
  if [[ -e "${file}" ]]; then
    return
  fi
  : >"${file}"
  chmod 600 "${file}"
  local entry
  for entry in "$@"; do
    secret_line "${entry%%=*}" "${entry#*=}" >>"${file}"
  done
  echo "dev-vars.sh: wrote ${file}" >&2
}

# --- main ---

main() {
  cd "$(repo_root)"
  if [[ ! -e "${SECRETS_DIR}/github-app-key.pem" ]]; then
    generate_secrets
  fi
  write_dev_vars "src/workers/notifier/.dev.vars" "GITHUB_APP_PRIVATE_KEY=github-app-key.pem" "REPLY_TOKEN_SECRET=reply-token-secret"
  write_dev_vars "src/workers/github/.dev.vars" "GITHUB_WEBHOOK_SECRET=webhook-secret"
  write_dev_vars "src/workers/inbound-mail/.dev.vars" "REPLY_TOKEN_SECRET=reply-token-secret"
  write_dev_vars "dev/fake-github/.dev.vars" "GITHUB_APP_PRIVATE_KEY=github-app-key.pem" "GITHUB_WEBHOOK_SECRET=webhook-secret"
}

main "$@"
