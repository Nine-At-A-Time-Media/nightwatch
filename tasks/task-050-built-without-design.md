---
id: task-050
kind: bug
title: Behavior built without a design: ids, scopes, mail authentication, quotas
created: 2026-11-08
implements: docs/design/DESIGN.NIGHTWATCH.md
---

Drift, built but not specified -- does each need designing? Short Id grammar (src/domain/issue/short-id.ts:16); Access Token scope names and role sets (src/domain/tenancy/access-token.ts); inbound mail requires DMARC pass (src/adapters/email/inbound-reply.ts:23); Report filing keys and their unbounded growth; crashed and abnormal Sessions both count as crashes; the Project normal hourly rate formula (src/adapters/do-sqlite/sqlite-issue-store.ts); QuotaDO is a fixed window per request with no isolate lease and no Rate Limiting guard (src/adapters/do/quota.ts:37), unlike the architecture's Mechanism > Ingest. Record each in docs/arch/ when it ships.
