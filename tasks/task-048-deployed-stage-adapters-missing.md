---
id: task-048
kind: bug
title: Deployed-stage adapters are missing; every Worker refuses a non-local stage
created: 2026-11-08
implements: docs/design/ARCHITECTURE.NIGHTWATCH.md
---

Drift, spec'd not built. The architecture names day-one adapters K2 (ArrivalStream), Basin Pipelines and SQL (ArchiveSink, ArchiveQuery), Workers AI (second SpamJudge) and the KV project-config copy on deployed stages. None of K2, Basin or Workers AI exists under src/adapters/, and ingest, processor, github and others answer 500 stage-has-no-adapters off the local stage (src/workers/ingest/index.ts:47, src/workers/github/index.ts:36). Consequence: Nightwatch cannot be deployed yet; the release is R0 until these land.
