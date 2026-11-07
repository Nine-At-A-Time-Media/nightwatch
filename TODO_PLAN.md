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

The domain core is in place and tested: protocol, sign-in, grouping,
issue lifecycle, ingest admission, event processing, reports, tracker,
alerts, monitors and search (`src/domain/`). Use cases exist for
admission and the issue lifecycle (`src/application/`). The ingest
Worker runs on local Wrangler with the `LogDO` stand-in for K2, R2, KV
and Durable Object adapters (`src/workers/ingest`, `pnpm dev`). Report
use cases and the report widget are in flight.

## Now

- task-009 -- report use cases; defines `ProjectClient` and `ControlStore`.
- task-020 -- the report widget.
- task-008 -- processArrival over the processing domain; needs task-009's ports.
- task-012 -- the core Worker (`ProjectDO`, `LogDO`, `QuotaDO`) and the pump.
- task-011 -- GitHub sync use cases over the tracker domain.

## Blockers

- Design and architecture approval is the owner's merge. The owner
  directed implementation to proceed on the branch meanwhile
  (2026-11-07).

## Lessons Learned
