---
id: task-004
kind: task
title: admitArrival use case and the Ingest behaviors
created: 2026-11-07
blocked_by: [task-003]
implements: docs/design/DESIGN.NIGHTWATCH.md
---

Ports `ProjectConfigSource`, `QuotaGate`, `ArrivalStream`, `BlobStore`,
`MetricsSink`, `ArchiveSink`, `Clock` with in-memory fakes; one RED/GREEN
commit per Ingest behavior row.
