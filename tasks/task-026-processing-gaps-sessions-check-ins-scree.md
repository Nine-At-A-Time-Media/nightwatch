---
id: task-026
kind: task
title: Processing gaps: sessions, check-ins, screenshots in envelopes, grouping transition window
created: 2026-11-07
implements: docs/design/DESIGN.NIGHTWATCH.md
---

Remaining: feedback screenshots sent as an attachment in the same envelope
are not filed with their Report, and only one Grouping Version is applied
(the transition window, design Grouping > Versioning, is not). Sessions
(Crash-free rate) and envelope check-ins (through `MonitorClient`) landed
2026-11-07; HTTP check-ins are forwarded at ingest and must not also be
advanced by processing.
