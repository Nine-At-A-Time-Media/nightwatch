---
id: task-039
kind: task
title: Alert signals for every Event, and the open_github_issue alert action
created: 2026-11-07
implements: docs/design/DESIGN.NIGHTWATCH.md
---

Frequency and every-event triggers cannot fire: the notifier sees only Issue Changes, and processArrival enqueues nothing when an Event changes no state (evaluateIssueAlerts gets event: null). Enqueue an alert signal per assigned Event (Issue id, Event Summary) and evaluate it. The open_github_issue action stays pending: call openExternalIssue from the notifier step. Design rows: Frequency alert, New issue alert (action). Reported by task-033.
