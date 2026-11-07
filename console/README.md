# @nightwatch/console

The console Worker: a Nuxt 4 app on Nitro's `cloudflare-module` preset. It
serves the triage pages, the Follow-up Page, and the API the report widget
and the pages call. Every request is signed in with a Cloudflare Access
assertion that Nightwatch verifies itself.

Design and architecture records live at the repository root:
`docs/design/DESIGN.NIGHTWATCH.md` and
`docs/design/ARCHITECTURE.NIGHTWATCH.md` (Module map: `console/server/` is
the console's composition root, `console/app/` its browser adapters).

## Using the root package

The console imports the root package's `src/` through the `#nightwatch`
alias (`nuxt.config.ts`, and the same alias in `vitest.*.config.ts`):

```ts
import { fileReport } from '#nightwatch/application/reports/file-report.js';
```

An alias was chosen over a workspace dependency with an `exports` map: the
root package publishes nothing, its sources carry `.js` import suffixes
that Nitro and Vite resolve to `.ts` either way, and an alias keeps one
copy of each module in the Worker bundle with no build step in between.

## Layout

| Path | Layer | Holds |
|---|---|---|
| `server/api/` | composition root | Nitro routes. Each builds deps from the request's bindings and calls one handler. |
| `server/routes/dev/sign-in.get.ts` | composition root | The local stage's sign-in helper. Answers 404 on every other stage. |
| `server/handlers/` | composition root | Entry points as plain functions `(Request, ..., deps) -> Response`. Each parses, calls one use case and shapes the answer. |
| `server/deps.ts` | composition root | Names the adapter behind each port and reads the settings from the Worker's vars. |
| `app/pages/`, `app/components/`, `app/utils/` | adapters | The pages, and presentational components that take props and emit events. |
| `tests/server/`, `tests/components/` | test | Handler tests with the root's in-memory fakes, and component tests in happy-dom. |

## API

| Route | Use case | Answers |
|---|---|---|
| `POST /api/report` | `fileReport` | The widget's HTTP contract (`widget/README.md`): 201 `{reference, status, followUpUrl}`. 400, 401, 409, 429 (with `retry-after`) or 503 `{refusal}`. |
| `GET /api/report-form?project=` | `openReportForm` | 200 `{reporter, fields}`. |
| `GET /api/follow-up/:reference` | `viewFollowUp` | 200 Follow-up View. 404 for anyone but the reporter and the Project's Members. |
| `POST /api/follow-up/:reference/reply` | `replyAsReporter` | `{text}` -> 201. |
| `GET /api/my-reports` | `listMyReports` | 200 `{reports}`. |
| `GET /api/projects/:project/issues?query=&cursor=` | `searchIssues` | 200 `{issues, next}`. The page covers the Member's Organization; each Issue names its own `projectId`. |
| `GET /api/projects/:project/issues/:issue` | `viewIssue` | 200 Issue, Short Id, every Comment, External Link. |
| `POST /api/projects/:project/issues/:issue/triage` | `triageIssue` | A triage action, e.g. `{kind: "resolve", resolution: {kind: "in_next_release"}}` -> 200 `{changes}`. 409 for a transition the State Machine refuses. |
| `POST /api/projects/:project/issues/:issue/merge` | `mergeIssues` | `{sources}` -> 200 `{changes}`; the sources merge into this Issue. |
| `POST /api/projects/:project/issues/:issue/split` | `splitIssue` | `{fingerprints}` -> 200 `{changes}`. |
| `POST /api/projects/:project/issues/:issue/discard` | `discardIssue` | 200 `{changes}`. |
| `POST /api/projects/:project/issues/:issue/assign` | `assignIssue` | `{assignee}`: `"me"`, `{member}`, `{team}` or `null` -> 200 `{changes}`. |
| `POST /api/projects/:project/issues/:issue/comments` | `ProjectClient.addComment` | `{text, shared}` -> 201. |
| `POST /api/projects/:project/issues/:issue/github` | `openExternalIssue` | `{repository}` -> 201 External Link. 503 when no GitHub App is configured. |

Member routes first sign the Member in to the Project the path names
(`signInMember`). A Refusal answers with its reason only.

The Follow-up Page is `/follow-up/:reference`, the path the domain's
`followUpUrl` mints. `/reports/:reference` redirects there.

## Sign-in by stage

| Stage | Issuer keys | Assertion read from |
|---|---|---|
| `local` | `dev/local-issuer` over the `LOCAL_ISSUER` service binding | the `Cf-Access-Jwt-Assertion` header, or the `CF_Authorization` cookie that `/dev/sign-in` sets |
| any other | each trusted issuer's `/cdn-cgi/access/certs` over HTTPS | the `Cf-Access-Jwt-Assertion` header only. Building deps throws if `LOCAL_ISSUER` is bound. |

## Local development (offline, no Cloudflare account)

Local development runs the built Worker under `wrangler dev --local`. It
does not use `nuxt dev`, because Node offers none of the bindings the API
needs: D1, ProjectDO and QuotaDO in other scripts, R2, KV, Queues and
`send_email`. One wrangler session runs the console, the core and ingest
Workers and the local issuer, so the cross-script bindings resolve.

```bash
pnpm --filter @nightwatch/console dev
```

Seed a local Organization and Project that trust the local issuer, once
per checkout:

```bash
./scripts/wrangler.sh d1 migrations apply nightwatch-control --local -c console/wrangler.jsonc
./scripts/wrangler.sh d1 execute nightwatch-control --local -c console/wrangler.jsonc --command "INSERT INTO organizations VALUES ('org-local'); INSERT INTO projects (project_id, organization_id, slug) VALUES ('project-local', 'org-local', 'LOCAL'); INSERT INTO trusted_issuers VALUES ('org-local', 'http://local-issuer.localhost', '[\"nightwatch-console-local\"]'); INSERT INTO members VALUES ('member-mia', 'mia@example.com'); INSERT INTO memberships VALUES ('member-mia', 'org-local', 'owner'); INSERT INTO project_members (project_id, member_id, owner) VALUES ('project-local', 'member-mia', 1);"
```

Then sign in with `http://localhost:8787/dev/sign-in?email=mia@example.com`
and open `/my-reports` or `/projects/project-local/issues`. The local
issuer keeps its key pair in its own KV namespace under `.wrangler/state`,
so the key pair stays the same for each checkout.

## Commands

```bash
pnpm --filter @nightwatch/console build
pnpm --filter @nightwatch/console typecheck
pnpm --filter @nightwatch/console test
pnpm --filter @nightwatch/console cf-types
```

`build` sets `NITRO_PRESET=cloudflare-module` unless the variable is
already set. Re-run `cf-types` after changing `wrangler.jsonc`. The
console's tests also run from the root `pnpm test`, as the
`console-server` and `console-components` projects.
