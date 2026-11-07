---
id: task-035
kind: task
title: The console - Nuxt triage UI, Follow-up Page, report endpoint, local issuer
created: 2026-11-07
blocked_by: [task-028, task-029]
implements: docs/design/ARCHITECTURE.NIGHTWATCH.md
---

console/ Nuxt package on the Nitro cloudflare-module preset: server routes as thin entry points over the use cases (fileReport, viewFollowUp, listMyReports, replyAsReporter, searchIssues when present, issue actions), the triage pages, the Follow-up Page, and a dev local issuer serving Access-shaped keys.
