---
id: task-003
kind: task
title: Domain protocol - DSN, credentials, envelope parsing, Retry Advice
created: 2026-11-07
blocked_by: [task-002]
implements: docs/design/DESIGN.NIGHTWATCH.md
---

Pure functions in `src/domain/protocol`: DSN parse, credential location
(exactly one), envelope parse with length-delimited and newline items,
Retry Advice header rendering. Property tests for parse round-trips.
