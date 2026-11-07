---
id: task-025
kind: bug
title: Feedback filing is not idempotent on redelivery
created: 2026-11-07
implements: docs/design/DESIGN.NIGHTWATCH.md
---

A redelivered Arrival Record files a second Report for the same feedback item, because fileReport has no idempotence key. Evidence: task-008 report; K2 and LogDO deliver at least once.
