---
id: task-037
kind: bug
title: Reprocessing past the dedup window counts Events again
created: 2026-11-07
implements: docs/design/DESIGN.NIGHTWATCH.md
---

Symptom: reprocessRange over records older than ProjectDO dedup window re-counts their Events and can regress Issues. Impact: the design row Reprocess a range (counts equal a single processing) holds only while the dedup window is at least Raw Retention. Evidence: task-031 report; the design says reprocessing replaces derived state.
