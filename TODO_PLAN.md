# Nightwatch -- TODO Plan

> **Updated:** 2026-11-07
> **Design:** [docs/design/DESIGN.NIGHTWATCH.md](docs/design/DESIGN.NIGHTWATCH.md),
> [docs/design/ARCHITECTURE.NIGHTWATCH.md](docs/design/ARCHITECTURE.NIGHTWATCH.md)

## How to Use This File

- Work on a feature branch; never on `main`.
- One behavior per commit: `test(<scope>): ... (RED)` then
  `feat(<scope>): ... (GREEN)`, or one commit carrying both when the RED
  run is shown in the commit body.
- Tests: `pnpm test:unit` (domain and use cases, fakes only) and
  `pnpm test:integration` (Workers runtime, local Wrangler).
- Full gate before every push: `pnpm typecheck && pnpm lint && pnpm test`.
- Tasks live in `tasks/`; IDs are tier 0 (`task-NNN`, one past the
  highest, including `tasks/done/`).
- Resuming cold: `git log --oneline -5`, then the Now list below, then
  `pnpm test` to see what is RED.

## Where Things Stand

Nightwatch runs end to end on local Wrangler with no Cloudflare account:
`pnpm dev` starts every Worker (ingest, core, processor, notifier, github,
inbound-mail, monitors, scheduler, the console, and the local issuer and
fake GitHub stand-ins), and `pnpm test:e2e` drives an SDK envelope through
ingest, the `LogDO` arrival log, the pump and processing into `ProjectDO`.
The domain, use cases and adapters cover every design Behaviors row; the
remaining tasks are gaps the agents reported while building them.

## Now

- task-026 -- the rest of the processing gaps: screenshots in the envelope, the grouping transition window.
- task-037 -- reprocessing past the dedup window must replace an Event's derived state, not recount it.
- task-039 -- alert signals per Event (frequency triggers) and the GitHub alert action.
- task-040 -- Issue Changes name their Project; remove the console `lastProject()` workaround.

## Blockers

- Design and architecture approval is the owner's merge; implementation
  proceeds on branch `agent/trusting-ptolemy-vipzsk` by owner direction
  (2026-11-07). No PR is open yet.
- Architecture A-Q3: whether this public repository can call the fleet
  adherence workflow in CI. Until ruled, `bin/adhere` runs locally only.
- Architecture A-Q4: the fleet's hooks and ci.magic install from GitHub
  Packages; this repository uses public-registry tooling until ruled.
- The fleet radar still names the deprecated `@cloudflare/vitest-pool-workers`;
  `docs/TECH-RADAR.md` proposes `@cloudflare/vitest-plugin`.
- CI's `e2e` job joins `gate`'s needs after its first green run.

## Lessons Learned
