---
id: task-042
kind: bug
title: Raw retention stores the reporter's Access assertion
created: 2026-11-08
implements: docs/design/DESIGN.NIGHTWATCH.md
---

Drift, security rule -- decision needed. ArrivalRecord carries the forwarded Cf-Access-Jwt-Assertion for feedback items (src/domain/ingest/arrival.ts:58, admission.ts:52) so processing can verify it later. A bearer token then sits in the arrival log for Raw Retention. The design bounds raw retention and makes it readable only by reprocessing, but never contemplated credentials in it. Consequence: anyone who can read raw retention holds a still-valid sign-in until the token expires; a long pump lag also makes verification fail on expiry. Decide: verify at ingest and store only the verified Reporter identity, or keep the token.
