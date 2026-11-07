---
id: task-028
kind: task
title: ProjectDO with a SQLite IssueStore and the Durable Object ProjectClient
created: 2026-11-07
blocked_by: [task-015]
implements: docs/design/ARCHITECTURE.NIGHTWATCH.md
---

The core Worker hosting ProjectDO (and LogDO, QuotaDO moved from ingest), a SQLite IssueStore adapter passing the same contract suite as the fake, and a ProjectClient adapter over the Durable Object stub.
