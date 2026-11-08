---
id: task-044
kind: bug
title: Alert quiet period can fire twice under concurrency
created: 2026-11-08
implements: docs/design/DESIGN.NIGHTWATCH.md
---

Drift, rule violated. Design: an Issue Alert Rule fires at most once per Issue per Alert Quiet Period. evaluateIssueAlerts reads the last firing and then records a new one in separate ProjectClient calls (src/application/alerts/evaluate-issue-alerts.ts:135-137), not one transaction. Consequence: two concurrent effects for one Issue can both fire and both notify.
