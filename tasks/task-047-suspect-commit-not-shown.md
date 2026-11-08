---
id: task-047
kind: bug
title: Suspect Commit is computed but never shown
created: 2026-11-08
implements: docs/design/DESIGN.NIGHTWATCH.md
---

Drift, spec'd not built. Design row Suspect commit: Then the Suspect Commit and its author are shown. suggestOwners computes it (src/application/issues/suggest-owners.ts:134) but nothing stores it and the console has no read path. Consequence: the row's Then is unobservable.
