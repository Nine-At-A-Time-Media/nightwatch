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

The concept, design and architecture records are drafted and under panel
review. The repository has a toolchain and no product code yet. The core
is built domain-first: pure protocol, grouping and issue rules, then the
use cases over in-memory fakes, then the Workers that compose them on the
local Wrangler runtime.

## Now

- task-002 -- the adherence declaration must land before product code.
- task-003 -- the protocol domain every ingest path depends on.
- task-005, task-006 -- grouping and issue rules, independent of ingest.
- task-004 -- admitArrival once the protocol exists.
- task-007 -- assignEvent joins grouping and the issue lifecycle.

## Blockers

- Design and architecture approval is the owner's merge. The owner
  directed implementation to proceed on the branch meanwhile
  (2026-11-07).

## Lessons Learned
