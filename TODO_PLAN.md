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

- task-038 -- triage actions end to end (in flight).
- task-026, task-036 -- processing gaps and the Outcome double count (in flight).
- task-039 -- alert signals per Event and the GitHub alert action.
- task-040 -- Issue Changes name their Project.
- task-037 -- reprocessing past the dedup window (needs replace-derived-state).

## Blockers

- Design and architecture approval is the owner's merge. The owner
  directed implementation to proceed on the branch meanwhile
  (2026-11-07).

## Lessons Learned
