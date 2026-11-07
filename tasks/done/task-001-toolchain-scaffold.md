---
id: task-001
kind: task
title: Scaffold the pnpm workspace, TypeScript, Vitest, lint, and CI gate
created: 2026-11-07
implements: docs/design/ARCHITECTURE.NIGHTWATCH.md
---

Root package with strict TypeScript, Vitest (unit project in Node,
integration project on `@cloudflare/vitest-plugin`), ESLint, Prettier,
fast-check, Stryker config for `src/domain` and `src/ports`, and a GitHub
Actions `gate` job that runs typecheck, lint and the unit suite. Tooling
only; no product behavior.
