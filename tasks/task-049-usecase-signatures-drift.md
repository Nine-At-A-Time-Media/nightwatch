---
id: task-049
kind: bug
title: Use-case signatures differ from the architecture's use-case surface
created: 2026-11-08
implements: docs/design/ARCHITECTURE.NIGHTWATCH.md
---

Drift, shape changed. Many use cases take a leading project argument (IssueChange names no Project) and extra deps: fileReport, openReportForm, notifyReporters, openExternalIssue, pushIssueChange, releaseHealth, evaluateIssueAlerts (AlertSignal), evaluateMetricRule (MetricRuleTarget), searchIssues (clock), reprocessRange (subscription, processing), compareUsage (limits, operator), authorize and uploadArtifact (clock, ids), pumpArrivals (subscription, pump, settings). Consequence: the frozen record and the code name different contracts; the adherence Trace and Language checks read the record. Decide per row whether the record is amended (with task-040) or the code conforms.
