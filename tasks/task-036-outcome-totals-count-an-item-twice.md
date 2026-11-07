---
id: task-036
kind: bug
title: Outcome Totals count an item twice when processing refuses it
created: 2026-11-07
implements: docs/design/DESIGN.NIGHTWATCH.md
---

Symptom: admission archives an accepted Outcome per item and processing archives a second Outcome (discarded, invalid, deferred) for the same item, so outcomeTotals counts it twice. Impact: G17 (every Arrival ends in exactly one recorded Outcome) is violated in the totals. Evidence: src/domain/outcome/totals.ts header; task-031 report.
