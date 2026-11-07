---
id: task-023
kind: task
title: Unify the Artifact index: one ControlStore read for processing and upload
created: 2026-11-07
implements: docs/design/DESIGN.NIGHTWATCH.md
---

ControlStore has two Artifact index reads (findArtifacts by Organization from task-022, artifactsFor by Project from task-008) over separately seeded state. Processing must find exactly what uploadArtifact wrote. Keep one read, scoped by Organization, and route both use cases through it.
