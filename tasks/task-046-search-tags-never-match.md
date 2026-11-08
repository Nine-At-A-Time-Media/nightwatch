---
id: task-046
kind: bug
title: Search tag filters never match
created: 2026-11-08
implements: docs/design/DESIGN.NIGHTWATCH.md
---

Drift, spec'd not built. Design Issues > Search includes tags; IssueFacts.tags is always empty because tags are not stored per Issue (src/application/issues/search-project-page.ts:64). Consequence: any query with a tag term returns nothing, silently.
