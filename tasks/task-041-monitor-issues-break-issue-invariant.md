---
id: task-041
kind: bug
title: Monitor issues hold neither a Fingerprint nor a Report
created: 2026-11-08
implements: docs/design/DESIGN.NIGHTWATCH.md
---

Drift, rule violated -- decision needed. The design's Domain Language says an Issue holds at least one Fingerprint or one Report. A monitor issue opened by advanceMonitor holds neither (src/domain/monitor/monitor-issue.ts:20, createMonitorIssue). Consequence: any rule or query that relies on the invariant (merge, search facts, Report Status) can meet an Issue it does not expect. Decide: amend the invariant to admit monitor issues, or give monitor issues a stable synthetic Fingerprint.
