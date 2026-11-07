---
id: task-032
kind: task
title: Processor Worker, StreamPumpDO, and the end-to-end local pipeline
created: 2026-11-07
blocked_by: [task-028, task-029]
implements: docs/design/ARCHITECTURE.NIGHTWATCH.md
---

The pump that pulls the arrival log and runs processArrival into ProjectDO; ingest and processor wired to the D1 ControlStore; an end-to-end test from an SDK envelope to an Issue on local Wrangler.
