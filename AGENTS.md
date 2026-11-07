# Project Guidelines for AI Agents

> `AGENTS.md` is the one real file; `CLAUDE.md` is a symlink to it.

## Clean-room rule (CRITICAL)

Nightwatch is a clean-room reimplementation of an error-tracking and
user-feedback feature set. Sentry 24.10.0 was studied for mechanics only.
See `LICENSE.md`, Acknowledgements.

- **NEVER** commit Sentry source code, comments, documentation prose, UI
  copy, schemas, fixtures, or test data to this repository, in any form.
- **NEVER** paste or closely paraphrase Sentry expression into a doc,
  issue, PR, or code comment. Describe mechanics in your own words.
- Reference checkouts of Sentry repositories live outside this repository
  (a scratch directory). Never clone one inside this tree. `.gitignore`
  blocks the usual names as a backstop, not as permission.
- Citing a Sentry file path as provenance for a mechanic is allowed.
  Quoting its contents is not.
- The Sentry SDK wire protocol (DSN, envelope) is implemented from its
  observable behavior, so that unmodified Sentry SDKs can send to
  Nightwatch.

## Hosting and development

- Cloudflare only (Workers, Durable Objects, D1, R2, K2, Queues,
  Workflows, and peers). A component that cannot run on Cloudflare is a
  design problem, not a reason to add another host.
- Open source with no guaranteed hosting. The local Wrangler runtime is
  the reference environment: every use case must run and be tested with
  no Cloudflare account. Run `wrangler dev --local`; never `wrangler
  login`.
- A remote-only binding (K2, Workers AI, Analytics SQL, Vectorize) in a
  config's top level stops `wrangler dev` from starting. Keep them in
  adopter environment blocks; locally the stand-in adapters in
  `docs/design/ARCHITECTURE.NIGHTWATCH.md`, Local development, carry them.
- Keep tool state in the checkout: `XDG_CONFIG_HOME` and
  `WRANGLER_LOG_PATH` point inside it.
- Our own deployment, if any, keeps its Access objects and stage config
  in the private infra repo (tds-internal), never here.

## Records

- Concepts: `docs/concepts/<idea>/`. Disposable; never cited as authority.
- Design and architecture records: `docs/design/`. Body frozen once
  merged; Key Decisions is append-only.
- As-built: `docs/arch/`. Facts only, never intentions.

## Packages

- pnpm only (fleet radar); never npm or yarn. Pin `packageManager` to an
  exact version. `pnpm-workspace.yaml` allows install scripts for
  `esbuild` and `workerd` only.
- Tests: Vitest with `@cloudflare/vitest-plugin` (the renamed
  `@cloudflare/vitest-pool-workers`).

## Git

- Never commit or push to `main`. Use a feature branch and a PR.
- Markdown is ASCII only.
