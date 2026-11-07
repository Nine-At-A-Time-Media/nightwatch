# Nightwatch -- Architecture

> **Date:** 2026-11-07
> **Authors:** Nine-At-A-Time Media (drafted with AI assistance)
> **Implements:** [DESIGN.NIGHTWATCH.md](DESIGN.NIGHTWATCH.md)
> **As-built read:** `docs/arch/` is empty; nothing is deployed. Every
> component below is new.

---

## Overview

Nightwatch is a set of Cloudflare Workers around its stores of truth: a
K2 stream that holds every admitted Arrival as received, one Durable
Object per Project that owns that Project's Issues and Reports, and a D1
database that owns the control plane. Everything else is derived: event
payloads and attachments in R2, an analytical archive in Basin, live
metrics in Analytics Engine.

The core is TypeScript with no Cloudflare imports; every Cloudflare
product sits behind a port with an in-memory fake. Nightwatch is open
source and assumes no hosted deployment, so the local Wrangler runtime is
the first-class environment: every use case runs and is tested there,
with no Cloudflare account.

---

## Component diagram

```
 browser SDKs          product Worker            server SDKs     GitHub    mail
 (errors, feedback)    (behind Access)               |              |        |
      |                     |                        |              |        |
      +-- tunnel route ---->+-- forwards with ------>+              |        |
          (same origin)         Access assertion     |              |        |
                                                     v              v        v
 +----------------+                           +-----------+  +--------+ +---------+
 | widget (report |                           |  ingest   |  | github | | inbound |
 | form, in the   |--- via tunnel ----------->|  Worker   |  | Worker | | -mail   |
 | product page)  |                           +-----+-----+  +---+----+ +----+----+
 +----------------+                                 |            |           |
                                     produce        v            |           |
                              +-------------+  bodies over the   |           |
                              |  K2 stream  |  record cap -> R2  |           |
                              |  arrivals   |                    |           |
                              +------+------+                    |           |
                                     | pull (lease, ack)         |           |
                                     v                           v           v
 +--------------+  assign  +--------------------------------------------------+
 | processor    |--------->|  core Worker: ProjectDO (one per Project,        |
 | Worker +     |          |  SQLite): Issues, Fingerprints, Tombstones,     |
 | StreamPumpDO |          |  counters, Reports, Threads, History, event     |
 +--+--+--+-----+          |  index, sweep alarms. QuotaDO per Project.      |
    |  |  |                +---------------------+----------------------------+
    |  |  +-> R2 events/, attachments/           | Issue Changes (ids)
    |  +----> Basin Pipelines -> Basin Catalog   v
    |         (archive, Outcomes)          +-----------+    +------------------+
    +-------> Analytics Engine (live)      |  Queues   |--->| notifier Worker  |
                                           |  effects  |    | DigestDO, mail,  |
                                           +-----+-----+    | webhooks         |
                                                 +--> github Worker (outbound)
 +-------------------------+     +------------------+     +-------------------+
 | console Worker (Nuxt):  |<--->| D1 control plane |<--->| KV project-config |
 | triage UI, Follow-up    |     +------------------+     | (read by ingest)  |
 | Page, API (Access)      |
 +-------------------------+
 monitors Worker: MonitorDO (one per monitor), MetricRuleDO (one per rule)
 scheduler Worker: Cron Triggers (archive maintenance, Platform Usage)
```

---

## Repository layout

A pnpm workspace. The product core and every Worker live in the root
package so the root `adherence.toml` and the records in `docs/design/`
govern one tree; the two browser applications are packages of their own.

| Path | Holds | Package |
|---|---|---|
| `src/domain/` | rules, values, policies | root |
| `src/ports/` | one interface per seam | root |
| `src/application/` | one module per use case | root |
| `src/adapters/<product>/` | one implementation per port per mechanism | root |
| `src/workers/<worker>/` | one composition root per runtime, with its `wrangler.jsonc` | root |
| `tests/unit/`, `tests/integration/`, `tests/e2e/`, `tests/_fakes/` | the test layers and the fakes | root |
| `console/` | the Nuxt triage console and Follow-up Page | `@nightwatch/console` |
| `widget/` | the embeddable report form, a Vue custom element | `@nightwatch/widget` |

---

## Seams

Each volatile axis has one seam. Every port has an in-memory fake on day
one; the "Second mechanism" column says why the seam is not ceremony.

| Axis | Seam | Kind | Day-one adapter | Second mechanism |
|---|---|---|---|---|
| Durable arrival log | `ArrivalStream` | port | K2 | `LogDO`, an append-only log in a Durable Object with subscriptions and leases. The local stage runs on it, because K2 has no local emulation. |
| Payload and file storage | `BlobStore` | port | R2 | in-memory fake |
| Control-plane records | `ControlStore` | port | D1 | in-memory fake |
| Per-Project issue state | `IssueStore` | port | Durable Object SQLite, inside `ProjectDO` | in-memory fake; D1 if the per-object limit is outgrown |
| Reaching a Project's state from another runtime | `ProjectClient` | port | Durable Object stub | direct call into an in-process `IssueStore` (tests, local CLI) |
| Ingest-side project config | `ProjectConfigSource` | port | KV, written from D1 | D1 direct read |
| Admission quotas | `QuotaGate` | port | `QuotaDO` leases behind the Rate Limiting binding | Rate Limiting binding alone |
| Side-effect dispatch | `EffectQueue` | port | Queues with a dead-letter queue | Workflows for long jobs |
| Outbound mail | `Mailer` | port | Email Sending `send_email` binding | Email Sending REST API |
| Alert channel | `Channel` | port | email, webhook | Slack, PagerDuty |
| Issue tracker | `Tracker` | port | GitHub App | Jira |
| Code host | `CodeHost` | port | GitHub App (commits, blame, files, CODEOWNERS) | GitLab |
| Sign-in verification | `SignInVerifier` | port | Cloudflare Access JWT | the local issuer used in development and tests |
| Spam judgement | `SpamJudge` | port (the decision-models DecisionPort) | rules | Workers AI classifier |
| Analytical archive | `ArchiveSink` | port | Basin Pipelines to Basin Catalog | R2 NDJSON; the local stage runs on it, because the local Pipelines binding discards data |
| Archive query | `ArchiveQuery` | port | Basin SQL REST API | daily roll-up in D1; the local stage runs on it, because Basin SQL is remote only |
| Live metrics | `MetricsSink` | port | Analytics Engine | fake |
| Platform usage | `UsageSource` | port | Cloudflare account analytics API | fake |
| Uptime check | `UptimeProbe` | port | `fetch` from the monitors Worker | fake |
| Time | `Clock` | port | system clock | fake clock |
| Randomness | `Ids` | port | Web Crypto | seeded fake |
| Grouping rules | `GroupingVersion` | policy | the first version | later versions, matched side by side during transition |
| Regression | `RegressionPolicy` | policy | semantic-version-or-first-seen ordering | none planned |
| Early escalation | `EarlyEscalationPolicy` | policy | age, count, rate multiple | retuned only |
| Forecast | `ForecastPolicy` | policy | mean plus spread over recent hourly counts | retuned only |
| Digest timing | `DigestPolicy` | policy | minimum, increment, maximum | retuned only |
| Report Status | `reportStatusOf` | policy (pure function) | the design's Report Status table | none |
| Ownership | `OwnershipResolver` | policy | last match wins, rules over CODEOWNERS | none |
| Scrubbing | `ScrubbingRules` | policy | built-in rule set plus project rules | none |
| Inbound filters | `InboundFilters` | policy | built-in filter set plus project lists | none |
| Retention | `RetentionPolicy` | parameter set | per kind of data | none |
| Issue timing and escalation | `IssuePolicies` | parameter set | New Issue Age, Settle Age, Inbox Expiry, `EarlyEscalationPolicy`, `ForecastPolicy`, `RegressionPolicy` | none |

---

## Module map

Layers follow the coding skill: `domain`, then `ports`, then
`application` and `adapters` side by side, then the composition roots.
`application` and `adapters` never import each other. The root
`adherence.toml` declares exactly these globs.

| Unit | Layer | Runtime |
|---|---|---|
| `src/domain/protocol` (envelope, DSN, Retry Advice) | domain | all |
| `src/domain/normalize`, `src/domain/scrub`, `src/domain/sourcemap` | domain | processor |
| `src/domain/grouping` (Fingerprint derivation, rule languages, Grouping Versions) | domain | processor |
| `src/domain/issue` (Status machine, Resolution, Regression Policy, escalation, Forecast, snooze) | domain | core |
| `src/domain/report` (Report, Thread, `reportStatusOf`) | domain | core, console |
| `src/domain/search` (Issue Query parser and plan) | domain | console, core |
| `src/domain/alerts` (rule evaluation, Digest timing, breach counting) | domain | notifier, monitors |
| `src/domain/monitor` (schedules, Failure, thresholds) | domain | monitors |
| `src/domain/ownership`, `src/domain/release` (ordering, commit references) | domain | core, github |
| `src/domain/tenancy` (roles, Scopes, permission) | domain | console |
| `src/domain/signin` (claims to Reporter or Member, trusted issuers) | domain | all entry points |
| `src/ports/*` | ports | all |
| `src/application/*` | application | per use case |
| `src/adapters/k2`, `logdo`, `r2`, `r2-ndjson`, `d1`, `d1-rollup`, `do`, `kv`, `queues`, `email`, `github`, `access`, `workers-ai`, `rules`, `basin`, `wae`, `cf-usage`, `fetch` | adapters | as bound |
| `src/workers/ingest` | composition root | ingest Worker |
| `src/workers/processor` (+ `StreamPumpDO`) | composition root | processor Worker |
| `src/workers/core` (`ProjectDO`, `QuotaDO`, `LogDO`) | composition root | core Worker |
| `dev/local-issuer`, `dev/fake-github` (local stand-ins started by `pnpm dev`) | test | local stage only |
| `src/workers/notifier` (+ `DigestDO`) | composition root | notifier Worker |
| `src/workers/github` | composition root | github Worker |
| `src/workers/inbound-mail` | composition root | inbound-mail Email Worker |
| `src/workers/monitors` (`MonitorDO`, `MetricRuleDO`) | composition root | monitors Worker |
| `src/workers/scheduler` | composition root | scheduler Worker |
| `console/server/` (Nitro routes) | composition root | console Worker |
| `console/app/` (pages, components) | adapters | browser |
| `widget/src/` | adapters | browser |
| `tests/**` | test | Vitest |

Each Durable Object class is its own runtime: its constructor is a
composition root that builds its adapters once and hands ports to use
cases. A Worker `fetch` handler, a Nitro route and a queue consumer are
entry points: they parse, call one use case, and shape the response.

---

## Use-case surface

Every type is a term in the design's Domain Language. Values come first;
ports arrive last in one `deps` object. Every function returns a named
value from the design, or a `Refusal`.

### Ingest

| Design behavior | Use case (signature) | Ports |
|---|---|---|
| An SDK event is accepted; A disabled key is refused; A wrong origin is refused; An oversized arrival is refused; A quota rejects with retry advice; Noise is filtered; Out-of-scope data is counted; Durable before acknowledged; Noisy tenant | `admitArrival(arrival: Arrival, deps: {config: ProjectConfigSource, quota: QuotaGate, stream: ArrivalStream, blobs: BlobStore, metrics: MetricsSink, archive: ArchiveSink, clock: Clock}): Promise<Admission>` | ProjectConfigSource, QuotaGate, ArrivalStream, BlobStore, MetricsSink, ArchiveSink, Clock |

### Processing and grouping

| Design behavior | Use case (signature) | Ports |
|---|---|---|
| Source map applied; Missing source map; Scrubbing removes data; Duplicate arrival | `processArrival(record: ArrivalRecord, deps: {control: ControlStore, blobs: BlobStore, projects: ProjectClient, effects: EffectQueue, archive: ArchiveSink, clock: Clock}): Promise<ProcessingResult>` | ControlStore, BlobStore, ProjectClient, EffectQueue, ArchiveSink, Clock |
| Same crash, same issue; New crash, new issue; Concurrent first events; SDK fingerprint wins; Default token extends; Volatile parts ignored; Tombstoned events dropped; Early escalation; Archived until escalating; Archived until condition; Archived forever stays; Regression in newer release; No regression from older release; Hand-set priority sticks | `assignEvent(summary: EventSummary, fingerprints: Fingerprint[], deps: {issues: IssueStore, clock: Clock, ids: Ids, policies: IssuePolicies}): Promise<Assignment>` (inside `ProjectDO`) | IssueStore, Clock, Ids |
| Reprocess a range; Raw retention expired | `reprocessRange(project: ProjectId, range: TimeRange, deps: {stream: ArrivalStream, projects: ProjectClient, clock: Clock, retention: RetentionPolicy}): Promise<Reprocessing>` | ArrivalStream, ProjectClient, Clock |

### Issues

| Design behavior | Use case (signature) | Ports |
|---|---|---|
| New becomes ongoing; Auto-resolve | `sweepIssues(project: ProjectId, deps: {issues: IssueStore, effects: EffectQueue, clock: Clock, policies: IssuePolicies}): Promise<IssueChange[]>` (ProjectDO alarm) | IssueStore, EffectQueue, Clock |
| Resolve in next release | `recordReleaseSeen(release: Release, deps: {issues: IssueStore, effects: EffectQueue, clock: Clock}): Promise<IssueChange[]>` | IssueStore, EffectQueue, Clock |
| Merge | `mergeIssues(target: IssueId, sources: IssueId[], actor: Member, deps: {issues: IssueStore, blobs: BlobStore, effects: EffectQueue, clock: Clock}): Promise<IssueChange[] \| Refusal>` | IssueStore, BlobStore, EffectQueue, Clock |
| Split | `splitIssue(issue: IssueId, fingerprints: Fingerprint[], actor: Member, deps: {issues: IssueStore, ids: Ids, clock: Clock}): Promise<IssueChange[] \| Refusal>` | IssueStore, Ids, Clock |
| Discard | `discardIssue(issue: IssueId, actor: Member, deps: {issues: IssueStore, blobs: BlobStore, clock: Clock}): Promise<IssueChange[] \| Refusal>` | IssueStore, BlobStore, Clock |
| Owner suggested; Suspect commit | `suggestOwners(issue: IssueId, event: EventSummary, deps: {control: ControlStore, codeHost: CodeHost, projects: ProjectClient}): Promise<OwnerSuggestion>` | ControlStore, CodeHost, ProjectClient |
| Search; Cross-tenant search | `searchIssues(query: IssueQuery, viewer: Member, cursor: Cursor \| null, deps: {control: ControlStore, projects: ProjectClient}): Promise<IssuePage>` | ControlStore, ProjectClient |

### Reports

| Design behavior | Use case (signature) | Ports |
|---|---|---|
| Report filed in Nightwatch's form; Report filed through an SDK widget; Unsigned report refused; Empty message refused; Report quota | `fileReport(submission: ReportSubmission, signIn: SignIn \| null, deps: {verifier: SignInVerifier, quota: QuotaGate, projects: ProjectClient, control: ControlStore, blobs: BlobStore, spam: SpamJudge, effects: EffectQueue, ids: Ids, clock: Clock}): Promise<FilingReceipt \| Refusal>` | SignInVerifier, QuotaGate, ProjectClient, ControlStore, BlobStore, SpamJudge, EffectQueue, Ids, Clock |
| Reporter not asked who they are | `openReportForm(assertion: Assertion, deps: {verifier: SignInVerifier}): Promise<ReportForm \| Refusal>` | SignInVerifier |
| Failed send is visible | (the widget's own behavior; kept as a component test that drives the widget against a `fileReport` endpoint that fails) | none |
| Follow-up Page shows status; Follow-up Page refuses others; Unknown reference | `viewFollowUp(reference: ReportReference, assertion: Assertion, deps: {verifier: SignInVerifier, control: ControlStore, projects: ProjectClient}): Promise<FollowUpView \| Refusal>` | SignInVerifier, ControlStore, ProjectClient |
| Status change notifies; Fix ships; Duplicate reports share outcome; Unsubscribe | `notifyReporters(change: IssueChange, deps: {projects: ProjectClient, control: ControlStore, mailer: Mailer, clock: Clock}): Promise<ReporterNotification[]>` | ProjectClient, ControlStore, Mailer, Clock |
| Shared reply reaches reporter; Private comment stays private | `addComment(issue: IssueId, comment: Comment, actor: Member, deps: {issues: IssueStore, effects: EffectQueue, clock: Clock}): Promise<IssueChange[]>` | IssueStore, EffectQueue, Clock |
| Reporter reply reaches team | `replyAsReporter(reference: ReportReference, comment: Comment, assertion: Assertion, deps: {verifier: SignInVerifier, control: ControlStore, projects: ProjectClient, effects: EffectQueue, clock: Clock}): Promise<IssueChange[] \| Refusal>` | SignInVerifier, ControlStore, ProjectClient, EffectQueue, Clock |
| Spam is silent | `markSpam(report: ReportId, actor: Member \| SpamJudge, deps: {issues: IssueStore, clock: Clock}): Promise<IssueChange[]>` | IssueStore, Clock |
| My reports | `listMyReports(assertion: Assertion, deps: {verifier: SignInVerifier, control: ControlStore, projects: ProjectClient}): Promise<ReportList \| Refusal>` | SignInVerifier, ControlStore, ProjectClient |

### Alerts and notifications

| Design behavior | Use case (signature) | Ports |
|---|---|---|
| New issue alert; Quiet period; Frequency alert; Filter blocks | `evaluateIssueAlerts(change: IssueChange, deps: {control: ControlStore, projects: ProjectClient, channels: Channel[], clock: Clock}): Promise<AlertFiring[]>` | ControlStore, ProjectClient, Channel, Clock |
| Digest gathers | `deliverDigest(digest: Digest, deps: {mailer: Mailer, clock: Clock, policy: DigestPolicy}): Promise<Digest>` (DigestDO alarm) | Mailer, Clock |
| Metric incident opens and closes | `evaluateMetricRule(rule: MetricAlertRule, deps: {projects: ProjectClient, channels: Channel[], clock: Clock}): Promise<IncidentChange \| null>` (MetricRuleDO alarm) | ProjectClient, Channel, Clock |
| Reply by email; Unknown replier | `applyEmailReply(reply: InboundReply, deps: {control: ControlStore, projects: ProjectClient, clock: Clock}): Promise<IssueChange[] \| Refusal>` | ControlStore, ProjectClient, Clock |
| Settings respected | `notifyFollowers(change: IssueChange, deps: {control: ControlStore, projects: ProjectClient, mailer: Mailer}): Promise<WorkflowNotification[]>` | ControlStore, ProjectClient, Mailer |

### Code and GitHub

| Design behavior | Use case (signature) | Ports |
|---|---|---|
| Open GitHub issue | `openExternalIssue(issue: IssueId, repository: Repository, actor: Member, deps: {tracker: Tracker, projects: ProjectClient, control: ControlStore}): Promise<ExternalLink \| Refusal>` | Tracker, ProjectClient, ControlStore |
| GitHub close resolves; GitHub not-planned closes report; GitHub reopen; No echo; Shared GitHub comment; Uninstalled app | `applyTrackerEvent(event: TrackerEvent, deps: {control: ControlStore, projects: ProjectClient, clock: Clock}): Promise<IssueChange[] \| Refusal>` | ControlStore, ProjectClient, Clock |
| Nightwatch resolve closes GitHub; Contact never leaves | `pushIssueChange(change: IssueChange, deps: {tracker: Tracker, projects: ProjectClient, control: ControlStore}): Promise<ExternalLink \| Refusal>` | Tracker, ProjectClient, ControlStore |
| Resolve by commit | `applyCommits(commits: Commit[], deps: {control: ControlStore, projects: ProjectClient, clock: Clock}): Promise<IssueChange[]>` | ControlStore, ProjectClient, Clock |

### Releases and monitors

| Design behavior | Use case (signature) | Ports |
|---|---|---|
| Artifact upload | `uploadArtifact(upload: ArtifactUpload, token: AccessToken, deps: {control: ControlStore, blobs: BlobStore}): Promise<Artifact \| Refusal>` | ControlStore, BlobStore |
| CI token cannot read | `authorize(token: AccessToken, scope: Scope, deps: {control: ControlStore}): Promise<Grant \| Refusal>` | ControlStore |
| Crash-free rate | `releaseHealth(release: Release, environment: Environment, deps: {projects: ProjectClient}): Promise<ReleaseHealth>` | ProjectClient |
| Missed check-in; Overlong run; Monitor issue opens and resolves; URL down | `advanceMonitor(monitor: MonitorId, input: CheckIn \| ProbeResult \| null, deps: {projects: ProjectClient, probe: UptimeProbe, clock: Clock}): Promise<MonitorChange \| null>` (MonitorDO) | ProjectClient, UptimeProbe, Clock |

### Operating

| Design behavior | Use case (signature) | Ports |
|---|---|---|
| Outcome totals | `outcomeTotals(project: ProjectId, range: TimeRange, deps: {archive: ArchiveQuery}): Promise<OutcomeTotals>` | ArchiveQuery |
| Retention expiry | `enforceRetention(project: ProjectId, deps: {issues: IssueStore, blobs: BlobStore, clock: Clock, retention: RetentionPolicy}): Promise<Expiry>` | IssueStore, BlobStore, Clock |
| Erasure | `eraseReporter(reporter: Reporter, actor: Member, deps: {control: ControlStore, projects: ProjectClient, blobs: BlobStore}): Promise<Erasure \| Refusal>` | ControlStore, ProjectClient, BlobStore |
| Soft limit crossed | `compareUsage(deps: {usage: UsageSource, channels: Channel[], clock: Clock}): Promise<PlatformUsage[]>` | UsageSource, Channel, Clock |

---

## Mechanism

### Ingest

- The ingest Worker serves the SDK routes: envelope, legacy store,
  security reports, attachments and the HTTP cron check-in. Browsers post
  `text/plain`, so no preflight is needed.
- It reads DSN credentials from exactly one location and refuses a
  request that carries several.
- It reads the Project's config (Client Keys, origins, filters, size
  limits, Quotas, trusted issuers) from `ProjectConfigSource`. KV holds
  it; the console rewrites the entry whenever D1 changes.
- `QuotaGate` checks category Quotas. `QuotaDO` (one per Project) leases
  units to each ingest isolate, so most requests make no Durable Object
  call. The Rate Limiting binding guards each Client Key before `QuotaDO`.
- Items of out-of-scope kinds (transactions, spans, replays, profiles)
  are dropped with Outcomes.
- The Arrival is produced to the K2 stream `arrivals`. A body over the K2
  record limit, and every attachment, goes to R2 `raw/` first; the K2
  record carries the key. The Worker answers only after K2 reports
  success; a retryable K2 failure becomes a 503 with Retry Advice.
- One Outcome per item goes to Basin Pipelines (exact, archived) and to
  Analytics Engine (sampled, live).

### Sign-in

- Every Reporter and Member request carries a Cloudflare Access JWT.
  `SignInVerifier` checks its signature against the issuer's keys, its
  audience against the Organization's trusted applications, and its
  expiry, then yields the asserted email.
- Browser SDKs and the widget post to a **tunnel route** on the product's
  own origin, which Access already guards. The product's Worker forwards
  the request to the ingest or console Worker with the Access assertion
  it received. A browser never calls a Nightwatch hostname directly with
  a report, so no cross-site Access session is needed.
- The console is its own Access application. The Follow-up Page is a
  top-level navigation there, so Access sign-in works as usual.
- Nightwatch verifies the JWT itself and does not rely on `ctx.access`.
  Wrangler's local Access mock returns an identity without checking any
  token, so relying on it would leave the real check untested.
- Locally, a development issuer (a small Worker in the dev session)
  publishes keys and signs assertions with a key pair generated per
  checkout. The local composition root trusts only that issuer; a
  deployed composition root refuses to start if it is configured.

### Stream consumption and processing

K2 offers HTTP pull consumption with leases and no Worker consumer
binding. `StreamPumpDO` drives it:

- Each pump instance holds a `worker_id` on the shared subscription
  `processing`; several instances split the work.
- An alarm loop pulls a batch, calls `processArrival` per record through a
  service binding to the processor Worker, and acks the batch. A record
  that fails past its retry bound is written to R2 `deadletter/` and
  acked, with an Outcome.
- K2 gives no ordering across pumps, so processing is idempotent: Event
  ids key every write, and `ProjectDO` ignores an Event id it already
  counted within the dedup window.
- `processArrival` normalizes, scrubs, applies source maps, derives
  Fingerprints, stores the scrubbed Event in R2 `events/`, and calls
  `assignEvent` through `ProjectClient`. Feedback items become Reports
  through `fileReport`, carrying the sign-in the tunnel forwarded.
  Issue Changes go to the `effects` queue as ids.
- `reprocessRange` creates a subscription at the earliest retained
  record, skips records outside the Time Range by their server
  timestamp, and deletes the subscription when done. Raw Retention is
  therefore bounded by K2 stream retention.

### Grouping

- Fingerprint derivation is pure: `src/domain/grouping` takes the
  normalized Event, the Project's Fingerprint Rules and Stack Trace
  Rules, and the Grouping Version, and returns Fingerprints.
- `ProjectDO` handles one request at a time. That serialization is what
  makes "Concurrent first events" create one Issue, with no lock.
- A Tombstone hit returns an Assignment naming the Tombstone; the
  processor records the Outcome and deletes the R2 copy.

### Issues

- `ProjectDO` holds Issues, Fingerprints, Tombstones, Resolutions,
  snoozes, History, Comments, Reports, Threads, and exact per-hour
  counters (events, users by hashed id, Sessions by status).
- Status changes call `src/domain/issue`, which returns the next state
  and the Issue Changes; the DO writes both in one transaction.
- `ProjectDO` alarms run sweeps (age transitions, inbox expiry, snooze
  dates, auto-resolve, retention) and recompute Forecasts.
- Merge and split run as Workflows when they move more Events than one
  request can; affected Fingerprints are locked so new Events wait.
- Search parses the Issue Query in `src/domain/search`, resolves the
  viewer's Projects from D1, sends the plan to each `ProjectDO`, and
  merges the pages by sort key with a Cursor.

### Reports

- The widget is a Vue custom element the product embeds. It posts the
  Report Submission through the tunnel route and shows the Filing
  Receipt it gets back, including the Follow-up Page link.
- SDK `feedback` items take the ingest path and become Reports in
  `processArrival`.
- A Report Reference is 128 random bits, encoded for URLs. D1 stores only
  its hash, with the Organization, Project and Report it names.
- `reportStatusOf(issueState, externalLink)` is pure. `notifyReporters`
  computes the status before and after a change and sends a notice only
  when it differs.
- Notices carry the Follow-up Page link and a signed unsubscribe link.

### Alerts and notifications

- `evaluateIssueAlerts` runs per Issue Change from the `effects` queue.
  Rules without count triggers fire at once; count triggers read the
  exact counters in `ProjectDO`.
- The per-rule, per-Issue quiet period is a row in `ProjectDO`.
- `DigestDO` (one per recipient and rule) buffers items and sets its
  alarm from `DigestPolicy`.
- `MetricRuleDO` alarms on the rule's resolution, reads counters, counts
  consecutive breaches, and changes the Incident.
- Mail goes through the `send_email` binding. Each issue email carries a
  Reply-To address with an HMAC token naming the Issue and the recipient
  Member, and a Message-ID thread key per Issue.
- Email Routing delivers replies to the inbound-mail Email Worker, which
  verifies the token and the sender, strips quoted text, and calls
  `applyEmailReply`.

### Code and GitHub

- One GitHub App per deployment. The github Worker verifies webhook
  signatures, then handles `installation`, `installation_repositories`,
  `issues` (closed with its state reason, reopened), `issue_comment`,
  `push` and `pull_request`.
- Installation tokens are minted from the App key held as a Worker secret
  and cached in KV until shortly before expiry.
- No echo: every outbound change records the expected resulting GitHub
  state on the External Link. An inbound event that matches it, or whose
  actor is the App, is ignored.
- Shared GitHub comments: a comment that starts with the share marker
  enters the Thread. Who may use it is design Q3.
- Outbound bodies come from a template with no field for reporter
  addresses or Attachments. Evidence links point to the console, behind
  Access.
- Suspect commits use the GitHub GraphQL blame for the top in-app frame,
  through the Code Mapping.

### Releases, health and monitors

- Releases, deploys and the Artifact index live in D1. Artifacts live in
  R2, keyed by content hash, with chunked upload for large bundles.
- Sessions update per-minute counters in `ProjectDO`; Release Health is
  computed from them.
- `MonitorDO` (one per monitor) sets its alarm to the next expected
  Check-in plus margin, and to the maximum runtime when a run starts. It
  uses wall-clock alarms, not ingest time. Uptime monitors use the same
  DO with `UptimeProbe` on each alarm.

### Retention, archive and usage

- R2 lifecycle rules expire `raw/`, `events/` and `attachments/` by
  prefix, per retention window.
- `ProjectDO` deletes expired rows on its sweep alarm.
- Basin Pipelines writes processed Event Summaries and Outcomes to Basin
  Catalog (Iceberg) in the bucket `nightwatch-archive`. The scheduler
  Worker deletes expired partitions.
- The scheduler Worker runs `compareUsage` daily against the Platform
  Soft Limits.

### Security mitigations

| Design threat | Mitigation |
|---|---|
| Public Client Key | Ingest routes accept Client Keys only; the console never does. |
| Flood | Rate Limiting binding before `QuotaDO`; refusal before any write. |
| Personal data | Scrubbing runs in `processArrival` before R2 `events/` and before any DO write; `raw/` and K2 are read only by pumps. |
| Leaked Report Reference | 128 random bits, hashed at rest, revocable; `viewFollowUp` also requires the reporter's or a Member's sign-in. |
| Forged sign-in | `SignInVerifier` checks signature, issuer, audience and expiry; only issuers the Organization trusts count. |
| Reporter addresses to GitHub | The outbound template has no such field; a test asserts it for every outbound path. |
| Forged webhooks | HMAC verification before parsing. |
| Forged email replies | HMAC token in the address plus sender match. |
| Cross-tenant | `ProjectDO` ids derive from Project ids; entry points resolve the viewer's Projects before any DO call; tests cover search, Follow-up Pages and notices. |
| Stolen Access Token | Stored as hashes in D1; scoped; revocable; optional expiry. |
| Source maps | Readable only through the console, behind Access. |
| RPC exposure | Every step past an authorization check is a module function, never a method on a `WorkerEntrypoint` or Durable Object class (the cloudflare-hosting skill). |

---

## Local development

The local Wrangler runtime (workerd through Miniflare) is the reference
environment. CI runs the same.

- `pnpm dev` runs `wrangler dev --local` with every Worker's config in one
  session, so service bindings and cross-Worker Durable Object bindings
  resolve locally. Local state lives in `.wrangler/state`, gitignored and
  per checkout.
- No Cloudflare login and no account id are needed or read. Wrangler
  never runs `login` in this repository. `XDG_CONFIG_HOME` and
  `WRANGLER_LOG_PATH` point inside the checkout, so Wrangler writes
  nothing to the home directory (the coding skill, project-local tool
  state).
- The top level of each `wrangler.jsonc` is the local stage. It declares
  no remote-only binding. A remote-only binding in the config stops
  `wrangler dev` from starting at all without an API token. Adopters
  declare K2, Basin and Workers AI bindings in their own `nonprod` and
  `prod` environment blocks.
- Each composition root picks its adapters from the bindings present:
  `ArrivalStream` is K2 when a K2 binding exists, else `LogDO`, and so on
  for each row below. That choice is the only stage-dependent code.
- Tests run under `@cloudflare/vitest-plugin`, the renamed
  `@cloudflare/vitest-pool-workers`, so bindings in tests are the same
  runtime as in production.
- A real adapter whose product is remote only has a contract test that
  runs against a real account when credentials are present, and is
  skipped, never faked, when they are not (the testing skill).
- pnpm blocks install scripts by default; `pnpm-workspace.yaml` allows
  builds for `esbuild` and `workerd` only.

Measured on 2026-11-07 with wrangler 4.158.0 and workerd 1.20261104.1,
no login, no API token:

| Product | Local status | What carries it locally |
|---|---|---|
| Workers, service bindings, Static Assets | full | itself |
| Durable Objects (SQLite, alarms) | full | itself |
| D1, R2, KV | full | itself |
| Queues (with dead-letter queue) | full | itself |
| Workflows | full | itself |
| Cron Triggers | full when triggered by hand; crons do not fire on their own | the scheduled handler, called by tests and by `pnpm dev:tick` |
| Rate Limiting binding | full | itself |
| Email Sending | simulated: each message is written as an `.eml` file | itself |
| Email Workers (inbound) | full through the local email handler route | itself |
| Secrets Store | full once a secret is created locally | not used; Worker secrets in `.dev.vars` |
| K2 (produce and consume) | remote only; no local emulation | `LogDO` adapter |
| Basin Pipelines | no-op: data is discarded | R2 NDJSON `ArchiveSink` adapter |
| Basin SQL | remote only | D1 roll-up `ArchiveQuery` adapter |
| Analytics Engine | no-op: nothing stored | nothing needed; live charts are empty locally |
| Workers AI | remote only | rules `SpamJudge` adapter |
| Cloudflare Access | mock identity only; tokens are not checked | Nightwatch's own JWT check against the local issuer |
| Cloudflare account usage API | remote only | fake `UsageSource` |
| GitHub | external service | a local fake GitHub Worker (issues, comments, webhooks signed with a local secret) |

---

## Parameters placed

| Design parameter | Carried by |
|---|---|
| Event, Attachment and Arrival size limits | ingest settings, overridable per Project in D1 |
| Quota per category per scope; Report Quota | D1 project config, copied to KV; enforced by `QuotaGate` |
| Retry advice ceiling | ingest settings |
| Raw Retention | K2 stream retention and the R2 `raw/` lifecycle rule |
| Event, Attachment, Report, Outcome, History Retention | `RetentionPolicy` from D1 Organization settings; R2 lifecycle rules; Basin partition expiry |
| Clock-drift clamp | `src/domain/normalize` settings from the processor composition root |
| New Issue Age, Settle Age, Inbox Expiry | `IssuePolicies`, built by the `ProjectDO` composition root from D1 project config |
| Early Escalation Policy thresholds | `EarlyEscalationPolicy` in `IssuePolicies` |
| Forecast window and refresh | `ForecastPolicy` in `IssuePolicies` |
| Auto-Resolve Age | D1 project config |
| Alert Quiet Period, metric window, breach and recovery counts | D1 rule rows |
| Alert Evaluation Delay | `effects` queue batch timeout and consumer settings |
| Digest Minimum Delay, increment, Maximum Delay | `DigestPolicy` from notifier settings, overridable per Project |
| Suspect Commit Window | github settings |
| Grouping transition window | D1 project config (current and secondary Grouping Version, end time) |
| Report Reference lifetime | `RetentionPolicy` |
| Spam Judge threshold | `SpamJudge` adapter settings |
| Cron margin, maximum runtime, Uptime interval, failure and recovery counts | D1 monitor rows, read by `MonitorDO` |
| Reply-by-email address lifetime | notifier settings (token expiry) |
| Platform Soft Limits | scheduler settings, one value per product |
| Config propagation lag (introduced here: KV is eventually consistent) | KV cache TTL in ingest settings |
| Dedup window | `ProjectDO` settings |

"Settings" are Worker `vars` in each Worker's `wrangler.jsonc`, read once
by its composition root. The as-built records their values per stage.

---

## Operability

| Question | Answer |
|---|---|
| Release class | A tagged release of this repository is R2: it publishes packages and new configuration for adopters. Our own first deployment, if we make one, is R3 and owes the readiness review. |
| Stages and platforms | The repository defines the local stage only. An adopter adds `nonprod` and `prod` as Wrangler environments in their own config; bindings are repeated per environment, `workers_dev` is false, and `observability` is on (the cloudflare-hosting skill). Workers Paid is required for K2, Basin and Email Sending. |
| Rollout and rollback | Workers deploy with gradual versions; rollback is `wrangler rollback`. Durable Object schema changes are expand-contract migrations inside each DO. K2 records and R2 objects carry a schema version. Written data does not roll back. |
| Our own deployment | Not guaranteed. If we run one, its Access application, policies and tokens live in the private infra repo (tds-internal), and its Wrangler environments live there or in a private deploy repo, never in this public one. |
| Telemetry | OpenTelemetry semantics on Workers Logs and traces: `service.name`, `service.version`, `deployment.environment.name` on every record; structured JSON logs; no secret, reporter address or event content in any telemetry. |
| Data warehouse | Nothing is ledgered. Nightwatch is open source with no guaranteed host, and its Basin archive holds its history. A deployment of ours may add a ledger through its own record. |

### Likeliest failures

| Failure | How it is seen | How it is debugged | Seam or parameter |
|---|---|---|---|
| K2 beta outage or storage cap | ingest 503s; accepted Outcomes drop | Workers Logs on ingest; K2 dashboard | `ArrivalStream`; Raw Retention |
| Pumps fall behind | gap between ingest time and Event time grows | pump metric in Analytics Engine; K2 backlog | `StreamPumpDO` count |
| A `ProjectDO` grows hot or large | DO errors or latency on one Project | DO metrics by id | `IssueStore`; event index capacity |
| Email Sending quota reached | notifier errors; reporter notices delayed | notifier logs | `Mailer` |
| GitHub sync loop or drift | External Link broken or flapping | github Worker logs keyed by link | `Tracker`; no-echo record |
| Tunnel route missing or not forwarding the assertion | every report refused as unsigned | ingest Refusal reasons in Workers Logs | `SignInVerifier`; product integration |
| Config change not yet seen by ingest | a disabled key admits data briefly | KV entry age | config propagation lag |

---

## Adherence

- The root `adherence.toml` lands in its own PR before any code. It
  declares the layers in the Module map, the runtimes, `[records]`
  pointing at this record and the design record, and `[radar]` pointing
  at `docs/TECH-RADAR.md`.
- `console/` and `widget/` each carry their own `adherence.toml` with
  their layers and no `[records]`; their headers say the records live at
  the root.
- Build configuration files (`*.config.ts`, `wrangler.jsonc`) are named
  in the declaration's header as undeclared on purpose: tooling, not
  product.
- Records grow only. A behavior or term in an approved record is never
  renamed or removed; a superseding row is added beside it.
- The engine runs locally with `bin/adhere` from a tds-utils checkout.
  The CI caller depends on Open Question A-Q3.

---

## Radar proposals

`docs/TECH-RADAR.md` carries each row. Fleet rows keep the fleet's ring
and name the fleet as their source.

| Item | Ring | Source | Tier that gates it | Rationale |
|---|---|---|---|---|
| TypeScript (strict) | Adopt | fleet | none | The language of every runtime here. |
| pnpm | Trial | fleet | none | Package manager; `packageManager` pinned to an exact version. |
| Vitest | Adopt | fleet | none | Test runner. |
| `@cloudflare/vitest-plugin` | Trial | proposed, replacing the fleet's `@cloudflare/vitest-pool-workers` row | none | The old package is deprecated and renamed; its last release cannot load current bindings. The fleet row needs the same change. |
| Stryker (`@stryker-mutator/core`, vitest runner) | Adopt | fleet (testing-node) | none | Mutation score on `src/domain` and `src/ports`. |
| fast-check | Adopt | fleet (testing-node) | none | Property tests for parsers and policies. |
| Playwright | Adopt | fleet | none | Console and widget end-to-end tests. |
| zod (v4) | Adopt | fleet | none | Validation at every input boundary. |
| Prettier, ESLint | Adopt | fleet | none | Formatting and lint. |
| Vue 3 + Nuxt | Adopt | fleet | none | Console (Nitro `cloudflare-module` preset) and the widget (Vue custom element). |
| Cloudflare Workers, wrangler, Durable Objects, R2 | Trial | fleet | Workers Paid for production volume | Runtime, deploy tool, per-Project state, blobs. |
| Cloudflare Secrets Store | Trial | fleet | open beta | Not used at first: the GitHub App key is a per-Worker secret. |
| GitHub Actions | Adopt | fleet | none on a public repository | CI. |
| Cloudflare K2 | Trial | proposed | Workers Paid; public beta | The arrival log, behind `ArrivalStream`. |
| Cloudflare Basin (Pipelines, Catalog, SQL) | Trial | proposed | Workers Paid | Exact Outcomes and the archive. |
| D1, KV, Queues, Workflows | Trial | proposed | Workers Paid for production volume | Control plane, config cache, effects, long jobs. |
| Analytics Engine | Trial | proposed | none while unbilled | Live, sampled metrics. |
| Email Sending, Email Routing | Trial | proposed | Workers Paid and an onboarded domain; Sending is beta | Mail out and replies in. |
| Cloudflare Access | Trial | proposed | Zero Trust seats | Every sign-in. |
| Workers AI | Trial | proposed | none for the free allocation | Second `SpamJudge` adapter. |
| `jose` | Trial | proposed | none | JWT verification and signing. |
| `@jridgewell/trace-mapping` | Trial | proposed | none | Source map lookup. |
| `postal-mime` | Trial | proposed | none | Parse inbound replies. |
| Structured logging on Workers | Trial | proposed | none | The fleet logger, structlog, is Python only; Workers log structured JSON through `console`, which Workers Logs indexes. A gap to rule on. |

---

## Key Decisions

| Id | Decision | Choice | Rationale | Origin |
|---|---|---|---|---|
| A1 | Arrival log | K2, not Queues | Retention and replay (G2), fan-out, and a record size an Event fits in. | Drafting; owner named K2 |
| A2 | Issue state home | One Durable Object per Project | Serialized writes give one Issue per new Fingerprint without locks. | Drafting |
| A3 | Control plane | D1 | Relational, low volume, read by many Workers. | Drafting |
| A4 | Counters | Exact counters in `ProjectDO`; Analytics Engine only for live charts | Alerts, escalation and Forecasts need exact counts. | Drafting |
| A5 | Outcomes record | Basin Pipelines | Exact and cheap; totals are an archive query. | Drafting |
| A6 | Consumption | `StreamPumpDO` pulling K2 | K2 has no Worker consumer binding. | Drafting |
| A7 | Language | TypeScript on Workers | Every runtime is a Worker. | Drafting |
| A8 | K2 beta storage cap | Accepted as the ceiling on Raw Retention volume | Owner accepts account limits (design D10). | Owner, 2026-11-07 |
| A9 | Sign-in | Cloudflare Access JWT, forwarded through a same-origin tunnel route | Every user carries an Access token naming their email (design D11). | Owner, 2026-11-07 |
| A10 | Package manager | pnpm workspace | Fleet radar Trial row; owner direction. | Owner, 2026-11-07 |
| A11 | Reference environment | Local Wrangler | No hosted deployment is assumed (design D12). | Owner, 2026-11-07 |
| A12 | One root package for the core | Core and Workers in the root package; console and widget as packages | One `adherence.toml` reads the root records; per-package declarations cannot reach them. | Drafting, from the adherence skill |
| A13 | Console | Nuxt on Workers, merging the API, triage UI and Follow-up Page | Fleet Adopt row; one Access application. | Drafting |
| A14 | Local stand-ins | `LogDO` for K2, R2 NDJSON for Basin Pipelines, D1 roll-up for Basin SQL, own JWT check for Access | Those products have no working local emulation (spike, 2026-11-07); design G21 requires every behavior to run locally. | Drafting, from the spike |
| A15 | Who verifies an Assertion | The use case, through `SignInVerifier`; entry points pass the raw Assertion | Keeps the trust decision in one tested place; entry points stay thin. | Drafting, from task-010 |

---

## Open Questions

- **A-Q1 -- Basin SQL latency.** It has no Worker binding and no published
  timeout. If Outcome Totals are too slow for the console, a daily
  roll-up into D1 is the fallback.
- **A-Q2 -- `ProjectDO` size.** If a Project outgrows the per-object
  storage limit, the event index shards by month into child objects.
- **A-Q3 -- Adherence in CI for a public repository.** The caller
  workflow lives in tds-utils and needs a fleet secret. A public
  repository in another organization may not be able to call it; until
  ruled, the engine runs locally and the gap is named in each PR.
- **A-Q4 -- Fleet tooling.** The fleet's hooks and ci.magic install from
  GitHub Packages, which outside contributors cannot reach. The public
  repository uses public-registry equivalents unless the owner rules
  otherwise.
- **A-Q5 -- Cloudflare Issues.** If the design accepts importing it
  (design Q5), it needs an `ExternalSource` port; it has no public API
  today.

---

## Rejections

| Alternative | Reason |
|---|---|
| Queues as the arrival log | Messages are too small for Events, retention is short, and acked messages cannot be replayed. |
| D1 for issue state | One database is one writer for every Project; concurrency would need locks. |
| Analytics Engine for alert counts | Sampled; thresholds would fire on estimates. |
| Basin SQL on the request path | No binding and no latency guarantee. |
| Containers for processing | Nothing in scope needs a native runtime. |
| A `Symbolicator` port now | One mechanism (source maps in Workers) and no second in scope. |
| Hyperdrive to an external Postgres | Off Cloudflare. |
| Ingest-time clock for monitors | Durable Object alarms give a reliable wall clock. |
| Separate ports for Member and Reporter identity | Both are the same Access assertion; the domain decides which a person is. |
| Human checks (Turnstile) on reports | Every reporter is signed in (design D11). |
| Browser calls straight to a Nightwatch hostname | A cross-site Access session does not carry; the tunnel route keeps every call same-origin. |
| Per-package `adherence.toml` for the core | A package declaration cannot read records at the repository root. |
| npm | The fleet radar names pnpm; npm is not on it. |
| Wrangler's `access.dev` mock identity | It returns an identity without checking a token, so the real check would never run locally. |
| Remote bindings in local development | They need an account and a token; contributors have neither. |

---

## Related Documents

- [DESIGN.NIGHTWATCH.md](DESIGN.NIGHTWATCH.md) -- the capabilities this
  record delivers.
- [LICENSE.md](../../LICENSE.md) -- clean-room terms.
