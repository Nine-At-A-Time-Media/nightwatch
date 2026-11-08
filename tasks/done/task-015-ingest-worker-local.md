---
id: task-015
kind: task
title: Ingest Worker, LogDO stream stand-in, R2 blobs, and the local dev loop
created: 2026-11-07
implements: docs/design/ARCHITECTURE.NIGHTWATCH.md
---

First slice of task-012: the ingest Worker composition root over
`admitArrival`, the `LogDO` `ArrivalStream` adapter, R2 `BlobStore`, KV
`ProjectConfigSource`, the integration test project under
`@cloudflare/vitest-plugin`, and `pnpm dev` on local Wrangler.
