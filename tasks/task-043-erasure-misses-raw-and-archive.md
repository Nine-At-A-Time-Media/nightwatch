---
id: task-043
kind: bug
title: Erasure does not reach raw retention or the archive
created: 2026-11-08
implements: docs/design/DESIGN.NIGHTWATCH.md
---

Drift, rule violated. Design row Erasure reaches every store: a reporter's address and Reports must be gone from raw retention, History, the archive and every other store. eraseReporter (src/application/reports/erase-reporter.ts:60) reaches IssueStore, ControlStore and BlobStore only. Consequence: an erased reporter's address survives in the arrival log (task-042) and archived summaries until they expire.
