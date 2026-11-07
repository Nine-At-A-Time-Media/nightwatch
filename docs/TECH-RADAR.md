# Nightwatch Tech Radar

Rows this repository uses. Fleet rows keep the fleet's ring and name the
fleet as source; proposed rows come from
`docs/design/ARCHITECTURE.NIGHTWATCH.md`, Radar proposals, and land here
with the first code that uses them.

## Adopt

| Category | Technology | Source | Notes |
|---|---|---|---|
| Language | TypeScript (strict) | fleet | Every runtime. |
| Tests | Vitest | fleet | Unit project in Node; integration project in workerd. |
| Property tests | fast-check | fleet (testing-node) | Every parser and policy. |
| Validation | zod (v4) | fleet | Event normalization at the ingest boundary. |
| Format, lint | Prettier, ESLint (typescript-eslint) | fleet | printWidth 140, singleQuote, semi. |
| CI | GitHub Actions | fleet | Actions pinned by commit SHA. |

## Trial

| Category | Technology | Source | Notes |
|---|---|---|---|
| Package manager | pnpm | fleet | `packageManager` pinned exactly. |
| Runtime and deploy | Cloudflare Workers, wrangler | fleet | Local stage only in this repository. |
| Worker tests | @cloudflare/vitest-plugin | proposed | Replaces the deprecated `@cloudflare/vitest-pool-workers` fleet row. |
| JWT | jose | proposed | Access assertion verification; the local issuer. |
| Source maps | @jridgewell/trace-mapping | proposed | Pure lookup used by the source-map domain. |
