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

The retrospective of 2026-11-08 walked both records against the code.
Decisions needed first, then the remaining drift:

- task-042 -- decision: the Access assertion sits in raw retention (security).
- task-041 -- decision: monitor issues break the Issue invariant.
- task-043, task-044 -- erasure misses raw retention; the alert quiet period is not atomic.
- task-049, task-040 -- signatures vs the use-case surface; Issue Changes name their Project.
- task-039, task-026, task-037 -- alert signals per Event; processing gaps; reprocessing past dedup.
- task-045, task-046, task-047 -- notices, search tags, Suspect Commit display.
- task-048 -- deployed-stage adapters (K2, Basin, Workers AI) before any release.
- task-050 -- behavior built without a design: decide what gets designed.

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

## Lessons Learned

### Port-extending tasks conflict when run in parallel

about: wip

Domain-only tasks run in parallel merged with no conflicts. Every wave of
use-case tasks that appended to IssueStore, ControlStore and ProjectClient
conflicted, and union merges dropped braces. Sequence port-extending tasks,
or give one task ownership of each shared port per wave, until the shared
ports stop growing.
