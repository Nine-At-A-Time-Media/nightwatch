---
id: task-033
kind: task
title: Notifier, github and inbound-mail Workers, and the local fake GitHub
created: 2026-11-07
implements: docs/design/ARCHITECTURE.NIGHTWATCH.md
---

The effects queue consumer (evaluateIssueAlerts, notifyReporters, notifyFollowers, pushIssueChange, suggestOwners), DigestDO and its alarm, the GitHub webhook Worker (verify, map, applyTrackerEvent, applyCommits), the inbound-mail Email Worker (applyEmailReply), and dev/fake-github for the local stage.
