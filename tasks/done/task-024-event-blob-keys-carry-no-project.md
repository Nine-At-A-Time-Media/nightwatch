---
id: task-024
kind: bug
title: Event blob keys carry no Project
created: 2026-11-07
implements: docs/design/DESIGN.NIGHTWATCH.md
---

eventBlobKey is events/<sdk event id>. Two Projects that reuse an event id overwrite each other's stored Event (cross-tenant leak and data loss). Evidence: src/domain/event/event-summary.ts eventBlobKey; reported by task-008.
