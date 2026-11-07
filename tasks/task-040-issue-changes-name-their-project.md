---
id: task-040
kind: task
title: Issue Changes name their Project; drop the console lastProject workaround
created: 2026-11-07
implements: docs/design/ARCHITECTURE.NIGHTWATCH.md
---

An Issue Change carries no Project, so effect messages need one supplied beside it; the console builds its QueueEffectQueue over DurableProjectClient.lastProject(), which is only correct while one request touches one Project. Put the Project on the change (or return it from the use case) and remove lastProject. Reported by task-033.
