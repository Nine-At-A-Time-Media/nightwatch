---
id: task-038
kind: task
title: Triage actions end to end, and search results that name their Project
created: 2026-11-07
implements: docs/design/DESIGN.NIGHTWATCH.md
---

A triage use case (resolve variants, archive variants, unarchive, unresolve, set Priority, mark reviewed, discard, merge, split, assign) reachable through ProjectClient and ProjectDO, console routes and buttons for it; IssueFacts carry their Project so Organization-wide search links resolve; Short Ids use the Project slug from ControlStore, not the project id; a rules SpamJudge replaces the abstaining one. Reported by task-035.
