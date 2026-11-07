---
id: task-020
kind: task
title: The embeddable report widget (Vue custom element)
created: 2026-11-07
implements: docs/design/DESIGN.NIGHTWATCH.md
---

`widget/` package: a Vue custom element the product embeds. It asks only
for the message, an optional screenshot and an optional associated event,
posts the Report Submission to the product's tunnel route, and shows the
Filing Receipt (Report Reference and Follow-up Page link) or a visible
failure. Owns the "Failed send is visible" behavior.
