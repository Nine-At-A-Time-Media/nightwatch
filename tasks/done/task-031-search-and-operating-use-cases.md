---
id: task-031
kind: task
title: searchIssues and the Operating use cases
created: 2026-11-07
implements: docs/design/DESIGN.NIGHTWATCH.md
---

searchIssues over the search domain (fan-out through ProjectClient, viewer Projects from ControlStore); outcomeTotals (ArchiveQuery port, R2 NDJSON / D1 roll-up local adapter); enforceRetention; compareUsage (UsageSource port); reprocessRange (ArrivalSubscription from earliest, skip by time, Interrupted reprocess, Reprocessing is silent).
