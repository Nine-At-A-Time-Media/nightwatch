---
id: task-045
kind: bug
title: Reporter notices carry no signed unsubscribe link and re-mint references
created: 2026-11-08
implements: docs/design/ARCHITECTURE.NIGHTWATCH.md
---

Drift, spec'd not built and shape changed. Architecture Mechanism > Reports: notices carry the Follow-up Page link and a signed unsubscribe link. No signed unsubscribe link is built (src/application/reports/notify-reporters.ts). Because only reference hashes are stored, every notice mints a new Report Reference for the same Report (src/application/reports/file-report.ts:192,210). Consequence: a reporter cannot unsubscribe from the mail itself, and one Report accumulates many live references.
