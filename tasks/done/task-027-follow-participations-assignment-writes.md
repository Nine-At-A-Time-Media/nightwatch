---
id: task-027
kind: task
title: Follow participations, assignment writes and Report moves
created: 2026-11-07
implements: docs/design/DESIGN.NIGHTWATCH.md
---

Nothing records follow participations (addComment and assignment do not call addParticipation); IssueStore has an assignee read but no write; there is no moveReport use case. Needed by Settings respected, Report Status (Acknowledged), Duplicates.
