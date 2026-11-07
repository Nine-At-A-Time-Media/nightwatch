---
id: task-026
kind: task
title: Processing gaps: sessions, check-ins, screenshots in envelopes, grouping transition window
created: 2026-11-07
implements: docs/design/DESIGN.NIGHTWATCH.md
---

processArrival defers session and check-in items (Outcome discarded/deferred), ignores feedback screenshots in the same envelope, and applies only one Grouping Version. recordSession and advanceMonitor now exist (task-022); wire them in. Design rows: Crash-free rate, Missed check-in, versioning.
