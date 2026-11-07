# Nightwatch -- Architecture

> **Date:** 2026-11-07
> **Authors:** Nine-At-A-Time Media (drafted with AI assistance)
> **Implements:** [DESIGN.NIGHTWATCH.md](DESIGN.NIGHTWATCH.md)
> **As-built read:** `docs/arch/` is empty; nothing is deployed. Every
> component below is new.

---

## Overview

Nightwatch is a set of Cloudflare Workers around three stores of truth: a
K2 stream that holds every accepted Arrival as received, one Durable
Object per Project that owns that Project's Issues and Reports, and a D1
database that owns the control plane. Everything else is derived: event
payloads and attachments in R2, an analytical archive in Basin, live
metrics in Analytics Engine. The core is a TypeScript domain with no
Cloudflare imports; each Cloudflare product sits behind a port.

---

## Component diagram

```
 SDKs, browsers                  reporters                 GitHub      mail
      |                              |                        |          |
      v                              v                        v          v
 +-----------+   +----------------------------+   +-----------+  +--------------+
 |  ingest   |   | followup (report form,     |   |  github   |  | inbound-mail |
 |  Worker   |   | Follow-up Page, replies)   |   |  Worker   |  | Email Worker |
 +-----+-----+   +-------------+--------------+   +-----+-----+  +------+-------+
       | produce               | file Report            | apply sync     |
       v                       |                        |                |
 +-----------+  raw bodies     |                        |                |
 | K2 stream |  >record cap -> R2 raw/                  |                |
 | arrivals  |                 |                        |                |
 +-----+-----+                 |                        |                |
       | pull (lease/ack)      |                        |                |
       v                       v                        v                v
 +-----------+  assign   +-------------------------------------------------+
 | StreamPump|---------->|  ProjectDO (one per Project, SQLite)           |
 | DO + proc |           |  Issues, Fingerprints, Tombstones, counters,   |
 | Worker    |           |  Reports, Threads, History, event index,       |
 +--+--+--+--+           |  alarms for sweeps and Forecasts                |
    |  |  |              +-----------------------+-------------------------+
    |  |  +-> R2 events/, attachments/           | effects (ids only)
    |  +----> Basin Pipelines -> Basin Catalog   v
    |         (archive, Outcomes)          +-----------+     +-----------------+
    +-------> Analytics Engine (live)      |  Queues   |---->| notifier Worker |
                                           |  effects  |     | DigestDO, mail, |
                                           +-----+-----+     | webhooks        |
                                                 |           +-----------------+
                                                 +--> github Worker (outbound sync)
 +-----------+       +--------------------+       +--------------------------+
 |  api +    |<----->| D1 control plane   |<----->| KV project-config cache  |
 |  UI Worker|       | orgs, keys, rules, |       | (read by ingest)         |
 | (Access)  |       | releases, refs     |       +--------------------------+
 +-----------+       +--------------------+
 MonitorDO (one per monitor, alarms)   MetricRuleDO (one per rule, alarms)
 scheduler Worker (Cron Triggers: archive and retention maintenance)
```

---

## Seams

Each volatile axis has one seam. A port has a fake on day one and a real
adapter; the "Second mechanism" column says why the seam is not ceremony.

| Axis | Seam | Kind | Day-one adapter | Second mechanism |
|---|---|---|---|---|
| Durable arrival log | `ArrivalStream` | port | K2 | Queues, or K2's Kafka client support when it ships; K2 is beta |
| Payload and file storage | `BlobStore` | port | R2 | in-memory fake for tests |
| Control-plane records | `ControlStore` | port | D1 | in-memory SQLite fake |
| Per-Project issue state | `IssueStore` | port | Durable Object SQLite (inside `ProjectDO`) | in-memory SQLite fake; D1 if the per-object bound is outgrown |
| Ingest-side project config | `ProjectConfigSource` | port | KV, filled from D1 | D1 direct read; KV Instant when it leaves private beta |
| Admission quotas | `QuotaGate` | port | `QuotaDO` leases plus Workers Rate Limiting binding as flood guard | Rate Limiting binding alone |
| Side-effect dispatch | `EffectQueue` | port | Queues with a dead-letter queue | Workflows for long jobs |
| Outbound mail | `Mailer` | port | Email Sending `send_email` binding | Email Sending REST API |
| Alert channel | `Channel` | port | email, webhook | Slack, PagerDuty |
| Issue tracker | `Tracker` | port | GitHub App | Jira |
| Code host | `CodeHost` | port | GitHub App (commits, blame, files, CODEOWNERS) | GitLab |
| Member identity | `MemberIdentity` | port | Cloudflare Access JWT | another identity provider |
| Reporter identity | `ReporterIdentity` | port | Access JWT (misvtt), product-signed assertion | anonymous only |
| Human check on public forms | `HumanCheck` | port | Turnstile | none for signed-in reporters |
| Spam judgement | `SpamJudge` | port (decision-models DecisionPort) | rules | Workers AI classifier |
| Analytical archive | `ArchiveSink` | port | Basin Pipelines to Basin Catalog | R2 NDJSON |
| Archive query | `ArchiveQuery` | port | Basin SQL REST API | DuckDB over Iceberg off-platform (rejected by hosting rule, kept for tests) |
| Live metrics | `MetricsSink` | port | Analytics Engine | fake |
| Time | `Clock` | port | system clock | fake clock |
| Randomness | `Ids` | port | Web Crypto | seeded fake |
| Grouping rules | `GroupingVersion` | policy | `gv1` | future versions, matched side by side during transition |
| Regression | `RegressionPolicy` | policy | semantic-version-or-first-seen ordering | none planned |
| Early escalation | `EarlyEscalationPolicy` | policy | age, count, rate multiple | retuned only |
| Forecast | `ForecastPolicy` | policy | mean plus spread over recent hourly counts | retuned only |
| Digest timing | `DigestPolicy` | policy | minimum, increment, maximum | retuned only |
| Report Status | `reportStatusOf` | policy (pure function) | the table in the design | none |
| Ownership | `OwnershipResolver` | policy | last match wins, rules over CODEOWNERS | none |
| Scrubbing | `ScrubbingRules` | policy | built-in rule set plus project rules | none |
| Inbound filters | `InboundFilters` | policy | built-in filter set plus project lists | none |
| Retention | `RetentionPolicy` | parameter set | per kind of data | none |

---

## Module map

Packages are npm workspaces under `packages/`. Layers are enforced by
import rules: `domain` imports nothing; `application` imports `domain`
and `ports`; adapters import vendors; composition roots import all.

| Unit | Layer | Runtime |
|---|---|---|
| `domain/protocol` (envelope parse, DSN, rate-limit header) | domain | all |
| `domain/normalize`, `domain/scrub`, `domain/sourcemap` | domain | processor |
| `domain/grouping` (Fingerprint derivation, rule DSLs, versions) | domain | processor |
| `domain/issue` (status machine, Resolution, regression, escalation, Forecast, snooze) | domain | ProjectDO |
| `domain/report` (Report, Thread, `reportStatusOf`) | domain | ProjectDO, followup |
| `domain/search` (query language parser and plan) | domain | api, ProjectDO |
| `domain/alerts` (rule evaluation, Digest timing, metric breach counting) | domain | notifier, MetricRuleDO |
| `domain/monitor` (cron schedule, Failure, thresholds) | domain | MonitorDO |
| `domain/ownership`, `domain/release` (ordering, commit references) | domain | ProjectDO, github |
| `domain/tenancy` (roles, scopes, permission) | domain | api |
| `application/*` (one module per use case below) | application | per use case |
| `ports/*` (one interface per seam) | ports | all |
| `adapters/k2`, `adapters/r2`, `adapters/d1`, `adapters/do-sqlite`, `adapters/kv`, `adapters/queues`, `adapters/email`, `adapters/github`, `adapters/access`, `adapters/turnstile`, `adapters/workers-ai`, `adapters/basin`, `adapters/wae` | adapters | as bound |
| `workers/ingest` | composition root | ingest Worker |
| `workers/processor` (+ `StreamPumpDO`) | composition root | processor Worker |
| `workers/core` (`ProjectDO`, `QuotaDO`) | composition root | core Worker (Durable Object host) |
| `workers/api` (+ static UI assets) | composition root | api Worker |
| `workers/followup` | composition root | followup Worker |
| `workers/notifier` (+ `DigestDO`) | composition root | notifier Worker |
| `workers/github` | composition root | github Worker |
| `workers/inbound-mail` | composition root | Email Worker |
| `workers/monitors` (`MonitorDO`, `MetricRuleDO`) | composition root | monitors Worker |
| `workers/scheduler` | composition root | scheduler Worker (Cron Triggers) |

Each Durable Object class is its own runtime: its constructor is a
composition root that builds its adapters once and hands ports to use
cases.

---

## Use-case surface

Types are the design's Domain Language. Ports arrive in a final `deps`
object. Every function returns a named outcome value.

### Ingest

| Design behavior | Use case (signature) | Ports |
|---|---|---|
| An SDK event is accepted; A disabled key is refused; A wrong origin is refused; An oversized arrival is refused; A quota rejects with retry advice; Noise is filtered; Out-of-scope data is counted; Durable before acknowledged | `admitArrival(arrival: Arrival, deps: {config: ProjectConfigSource, quota: QuotaGate, stream: ArrivalStream, blobs: BlobStore, metrics: MetricsSink, archive: ArchiveSink, clock: Clock}) -> AdmissionOutcome` | ProjectConfigSource, QuotaGate, ArrivalStream, BlobStore, MetricsSink, ArchiveSink, Clock |

### Processing and grouping

| Design behavior | Use case (signature) | Ports |
|---|---|---|
| Source map applied; Missing source map; Scrubbing removes data; Duplicate arrival | `processArrival(record: ArrivalRecord, deps: {control: ControlStore, blobs: BlobStore, issues: IssueStoreClient, effects: EffectQueue, archive: ArchiveSink, clock: Clock}) -> ProcessingOutcome` | ControlStore, BlobStore, IssueStoreClient, EffectQueue, ArchiveSink, Clock |
| Same crash, same issue; New crash, new issue; Concurrent first events; SDK fingerprint wins; Default token extends; Volatile parts ignored; Tombstoned events dropped | `assignEvent(summary: EventSummary, fingerprints: Fingerprint[], deps: {issues: IssueStore, clock: Clock, ids: Ids, policies: IssuePolicies}) -> Assignment` (runs inside `ProjectDO`) | IssueStore, Clock, Ids |
| Reprocess a range; Raw retention expired | `reprocessRange(project: ProjectId, range: TimeRange, deps: {stream: ArrivalStream, issues: IssueStoreClient, clock: Clock, retention: RetentionPolicy}) -> ReprocessOutcome` | ArrivalStream, IssueStoreClient, Clock |

### Issues

| Design behavior | Use case (signature) | Ports |
|---|---|---|
| New becomes ongoing; Auto-resolve | `sweepIssues(project: ProjectId, deps: {issues: IssueStore, effects: EffectQueue, clock: Clock, policies: IssuePolicies}) -> SweepOutcome` (ProjectDO alarm) | IssueStore, EffectQueue, Clock |
| Early escalation; Archived until escalating; Archived until condition; Archived forever stays; Regression in newer release; No regression from older release; Hand-set priority sticks | (scenarios of `assignEvent`) | IssueStore |
| Resolve in next release | `recordReleaseSeen(release: Release, deps: {issues: IssueStore, effects: EffectQueue, clock: Clock}) -> ReleaseSeenOutcome` | IssueStore, EffectQueue, Clock |
| Merge | `mergeIssues(target: IssueId, sources: IssueId[], actor: Member, deps: {issues: IssueStore, blobs: BlobStore, effects: EffectQueue, clock: Clock}) -> MergeOutcome` | IssueStore, BlobStore, EffectQueue, Clock |
| Split | `splitIssue(issue: IssueId, fingerprints: Fingerprint[], actor: Member, deps: {issues: IssueStore, ids: Ids, clock: Clock}) -> SplitOutcome` | IssueStore, Ids, Clock |
| Discard | `discardIssue(issue: IssueId, actor: Member, deps: {issues: IssueStore, blobs: BlobStore, clock: Clock}) -> DiscardOutcome` | IssueStore, BlobStore, Clock |
| Owner suggested | `suggestOwners(issue: IssueId, event: EventSummary, deps: {control: ControlStore, codeHost: CodeHost, issues: IssueStoreClient}) -> OwnerSuggestion` | ControlStore, CodeHost, IssueStoreClient |
| Search; Cross-tenant search | `searchIssues(query: IssueQuery, viewer: Member, cursor: Cursor, deps: {control: ControlStore, issues: IssueStoreClient}) -> IssuePage` | ControlStore, IssueStoreClient |

### Reports

| Design behavior | Use case (signature) | Ports |
|---|---|---|
| Report filed in Nightwatch's form; Report filed through an SDK widget; Anonymous report with no address; Empty message refused; Report quota | `fileReport(submission: ReportSubmission, reporter: Reporter, deps: {quota: QuotaGate, issues: IssueStoreClient, control: ControlStore, blobs: BlobStore, spam: SpamJudge, effects: EffectQueue, ids: Ids, clock: Clock}) -> FilingOutcome` | QuotaGate, IssueStoreClient, ControlStore, BlobStore, SpamJudge, EffectQueue, Ids, Clock |
| Known reporter not asked | `openReportForm(request: FormRequest, deps: {reporters: ReporterIdentity}) -> ReportForm` | ReporterIdentity |
| Failed send is visible | (client behavior of the report form, tested in its component test against a failing `fileReport` endpoint) | none |
| Follow-up Page shows status; Unknown reference | `viewFollowUp(reference: ReportReference, deps: {control: ControlStore, issues: IssueStoreClient}) -> FollowUpView` | ControlStore, IssueStoreClient |
| Status change notifies; Fix ships; Duplicate reports share outcome; Unsubscribe | `notifyReporters(change: IssueChange, deps: {issues: IssueStoreClient, control: ControlStore, mailer: Mailer, clock: Clock}) -> ReporterNotices` | IssueStoreClient, ControlStore, Mailer, Clock |
| Shared reply reaches reporter; Private comment stays private | `addComment(issue: IssueId, comment: CommentDraft, actor: Member, deps: {issues: IssueStore, effects: EffectQueue, clock: Clock}) -> CommentOutcome` | IssueStore, EffectQueue, Clock |
| Reporter reply reaches team | `replyAsReporter(reference: ReportReference, body: string, deps: {control: ControlStore, issues: IssueStoreClient, human: HumanCheck, effects: EffectQueue, clock: Clock}) -> ReplyOutcome` | ControlStore, IssueStoreClient, HumanCheck, EffectQueue, Clock |
| Spam is silent | `markSpam(report: ReportId, actor: Member or SpamVerdict, deps: {issues: IssueStore, clock: Clock}) -> SpamOutcome` | IssueStore, Clock |
| My reports | `listMyReports(reporter: Reporter, deps: {control: ControlStore, issues: IssueStoreClient}) -> ReportList` | ControlStore, IssueStoreClient |

### Alerts and notifications

| Design behavior | Use case (signature) | Ports |
|---|---|---|
| New issue alert; Quiet period; Frequency alert; Filter blocks | `evaluateIssueAlerts(change: IssueChange, deps: {control: ControlStore, issues: IssueStoreClient, channels: Channel[], digests: DigestClient, clock: Clock}) -> AlertFirings` | ControlStore, IssueStoreClient, Channel, Clock |
| Digest gathers | `deliverDigest(key: DigestKey, deps: {mailer: Mailer, clock: Clock, policy: DigestPolicy}) -> DigestDelivery` (DigestDO alarm) | Mailer, Clock |
| Metric incident opens and closes | `evaluateMetricRule(rule: MetricAlertRule, deps: {issues: IssueStoreClient, channels: Channel[], clock: Clock}) -> IncidentChange` (MetricRuleDO alarm) | IssueStoreClient, Channel, Clock |
| Reply by email; Unknown replier | `applyEmailReply(message: InboundMail, deps: {control: ControlStore, issues: IssueStoreClient, clock: Clock}) -> ReplyOutcome` | ControlStore, IssueStoreClient, Clock |
| Settings respected | `notifyFollowers(change: IssueChange, deps: {control: ControlStore, issues: IssueStoreClient, mailer: Mailer}) -> WorkflowNotices` | ControlStore, IssueStoreClient, Mailer |

### Code and GitHub

| Design behavior | Use case (signature) | Ports |
|---|---|---|
| Open GitHub issue | `openExternalIssue(issue: IssueId, target: RepositoryRef, actor: Member, deps: {tracker: Tracker, issues: IssueStoreClient, control: ControlStore}) -> ExternalLinkOutcome` | Tracker, IssueStoreClient, ControlStore |
| GitHub close resolves; GitHub not-planned closes report; GitHub reopen; No echo; Shared GitHub comment; Uninstalled app | `applyTrackerEvent(event: TrackerEvent, deps: {control: ControlStore, issues: IssueStoreClient, clock: Clock}) -> SyncOutcome` | ControlStore, IssueStoreClient, Clock |
| Nightwatch resolve closes GitHub; Contact never leaves | `pushIssueChange(change: IssueChange, deps: {tracker: Tracker, issues: IssueStoreClient, control: ControlStore}) -> SyncOutcome` | Tracker, IssueStoreClient, ControlStore |
| Resolve by commit | `applyCommits(commits: Commit[], deps: {control: ControlStore, issues: IssueStoreClient, clock: Clock}) -> CommitOutcome` | ControlStore, IssueStoreClient, Clock |
| Suspect commit | (scenario of `suggestOwners`) | CodeHost |

### Releases and monitors

| Design behavior | Use case (signature) | Ports |
|---|---|---|
| Artifact upload | `uploadArtifact(upload: ArtifactUpload, token: AccessToken, deps: {control: ControlStore, blobs: BlobStore}) -> ArtifactOutcome` | ControlStore, BlobStore |
| CI token cannot read | `authorize(token: AccessToken, need: Scope, deps: {control: ControlStore}) -> Authorization` | ControlStore |
| Crash-free rate | `releaseHealth(release: Release, env: Environment, deps: {issues: IssueStoreClient}) -> HealthView` | IssueStoreClient |
| Missed check-in; Overlong run; Monitor issue opens and resolves; URL down | `advanceMonitor(monitor: MonitorId, input: CheckIn or Tick, deps: {issues: IssueStoreClient, probe: UptimeProbe, clock: Clock}) -> MonitorChange` (MonitorDO) | IssueStoreClient, Clock, UptimeProbe |

### Operating

| Design behavior | Use case (signature) | Ports |
|---|---|---|
| Outcome totals | `outcomeTotals(project: ProjectId, range: TimeRange, deps: {archive: ArchiveQuery}) -> OutcomeTotals` | ArchiveQuery |
| Retention expiry | `enforceRetention(scope: ProjectId, deps: {issues: IssueStore, blobs: BlobStore, clock: Clock, retention: RetentionPolicy}) -> RetentionOutcome` | IssueStore, BlobStore, Clock |
| Erasure | `eraseReporter(reporter: Reporter, actor: Member, deps: {control: ControlStore, issues: IssueStoreClient, blobs: BlobStore}) -> ErasureOutcome` | ControlStore, IssueStoreClient, BlobStore |
| Noisy tenant | (scenario of `admitArrival`) | QuotaGate |

`UptimeProbe` is the `fetch` the monitors Worker performs; it is listed
here because `advanceMonitor` needs it, and it is a port with a fake.

---

## Mechanism

### Ingest

1. The ingest Worker serves the SDK routes on its own hostname: envelope,
   legacy store, security reports, attachments, and the HTTP cron
   check-in. Browsers post `text/plain`, so no preflight is needed.
2. It parses the DSN credentials from exactly one location and rejects
   requests that carry several.
3. It reads the Project's config (Client Keys, origins, filters, size
   limits, quotas) from `ProjectConfigSource`. KV holds it, and the api
   Worker rewrites the entry whenever D1 changes.
4. `QuotaGate` checks category quotas. `QuotaDO` (one per Project) hands
   each ingest isolate a lease of units, so most requests make no Durable
   Object call. The Rate Limiting binding guards each Client Key against
   floods before `QuotaDO` is reached.
5. Items of out-of-scope kinds (transactions, spans, replays, profiles)
   are dropped with Outcomes.
6. The arrival is produced to the K2 stream `arrivals`. A body over the
   K2 record cap, and every attachment, is written to R2 under `raw/`
   first; the K2 record then carries the R2 key. The Worker answers only
   after K2 reports success. A retryable K2 failure becomes a 503 with
   retry advice.
7. One Outcome per item goes to Basin Pipelines (exact, archived) and to
   Analytics Engine (sampled, live).

### Stream consumption and processing

K2 offers HTTP pull consumption with leases and no Worker consumer
binding today. `StreamPumpDO` drives it:

1. Each pump instance holds a `worker_id` on the shared subscription
   `processing`. Several instances split the work.
2. An alarm loop pulls a batch, calls `processArrival` per record through
   a service binding to the processor Worker, and acks the batch. A
   failed record is nacked; after the retry bound it is written to R2
   `deadletter/` and acked, with an Outcome.
3. K2 gives no ordering across pumps. Processing is idempotent: event
   ids key every write, and `ProjectDO` ignores an event id it has
   already counted within the dedup window.
4. `processArrival` normalizes, scrubs, applies source maps, derives
   Fingerprints, stores the scrubbed event in R2 `events/`, and calls
   `ProjectDO.assignEvent`. Side effects (alerts, owners, GitHub,
   reporter notices) go to the `effects` queue as ids.

`reprocessRange` creates a new subscription starting at the earliest
retained record, skips records outside the range by their server
timestamp, and deletes the subscription when done. Raw Retention is
therefore bounded by K2 stream retention.

### Grouping

1. Fingerprint derivation is pure: `domain/grouping` takes the
   normalized event, the project's Fingerprint Rules and Stack Trace
   Rules, and the Grouping Version, and returns Fingerprints.
2. `ProjectDO.assignEvent` looks up the Fingerprints in its SQLite table.
   A Durable Object handles one request at a time, which is what makes
   "Concurrent first events" create one issue.
3. A Tombstone hit returns a discarded Assignment. The processor records
   the Outcome and deletes the R2 copy.

### Issues

- `ProjectDO` holds Issues, Fingerprints, Tombstones, Resolutions,
  snoozes, History, comments, Reports, Threads, and exact per-hour
  counters (events, users by hashed id, sessions by status).
- Status changes call `domain/issue`, which returns the next state and
  the History rows; the DO writes both in one transaction.
- `ProjectDO` alarms run sweeps (age transitions, inbox expiry, snooze
  dates, auto-resolve) and recompute Forecasts on the Forecast refresh.
- Merge and split run as Workflows when they touch more events than one
  DO request can move; the DO marks affected Fingerprints locked so new
  events wait in the DO's queue, then unlocks.
- Search parses the query in `domain/search`, resolves the viewer's
  Projects from D1, sends the plan to each `ProjectDO`, and merges the
  pages by sort key with a cursor.

### Reports

- The followup Worker serves Nightwatch's report form, the Follow-up
  Page, reporter replies, unsubscribe and "my reports".
- SDK `feedback` items take the ingest path and become Reports in
  `processArrival`. The form posts to the followup Worker, which calls
  `fileReport` directly and returns the Report Reference in the response.
- A Report Reference is 128 random bits, encoded for URLs. D1 stores only
  its hash, with the Organization, Project and Report it names.
- `ReporterIdentity` reads the Access JWT where the product is behind
  Access (misvtt), or a short-lived assertion the product signs with a
  per-Project secret. Without either, the reporter is anonymous.
- `reportStatusOf(issueState, externalLink)` is pure. `notifyReporters`
  computes the status before and after a change and sends a notice only
  when it differs.
- Reporter replies pass `HumanCheck` when the reporter is anonymous.
- Notices carry the Follow-up Page link and a signed unsubscribe link.

### Alerts and notifications

- `evaluateIssueAlerts` runs per `IssueChange` from the `effects` queue.
  Rules without count triggers fire at once. Count triggers read the
  exact counters in `ProjectDO`.
- The per-rule, per-issue quiet period is a row in `ProjectDO`.
- `DigestDO` (one per recipient and rule) buffers items and sets its
  alarm from `DigestPolicy`.
- `MetricRuleDO` alarms on the rule's resolution, reads counters,
  counts consecutive breaches, and changes the Incident.
- Mail goes through the `send_email` binding from a Nightwatch sending
  domain. Each issue email carries a Reply-To address with an HMAC token
  naming the issue and the recipient Member, and a Message-ID thread key
  per issue.
- Email Routing delivers replies to the inbound-mail Email Worker, which
  verifies the token and the sender, strips quoted text, and calls
  `applyEmailReply`.

### Code and GitHub

- One GitHub App per stage. The github Worker verifies webhook
  signatures, then handles `installation`, `installation_repositories`,
  `issues` (closed with its state reason, reopened), `issue_comment`,
  `push` and `pull_request`.
- Installation tokens are minted from the App key held in Secrets Store
  and cached in KV until shortly before expiry.
- No echo: every outbound change records the expected resulting GitHub
  state on the External Link. An inbound event that matches it, or whose
  actor is the App, is ignored.
- Shared GitHub comments: a comment by a repository collaborator that
  starts with the share marker enters the Thread. The marker spelling is
  an as-built value; who may use it is design Open Question 5.
- Outbound bodies are built from a template that has no field for
  contact details or attachments. Evidence links point to the api
  Worker, behind Access.
- Suspect commits use the GitHub GraphQL blame for the top in-app frame,
  through the Code Mapping.

### Releases, health and monitors

- Releases, deploys and the Artifact index live in D1. Artifacts live in
  R2, keyed by content hash, with chunked upload for large bundles.
- Sessions update per-minute counters in `ProjectDO`. Crash-free rates
  are computed from them.
- `MonitorDO` (one per monitor) sets its alarm to the next expected
  check-in plus margin, and to the maximum runtime when a run starts.
  It uses wall-clock alarms, not ingest time.
- Uptime monitors use the same DO with a `fetch` probe on each alarm.

### Retention and archive

- R2 lifecycle rules expire `raw/`, `events/` and `attachments/` by
  prefix, per retention window.
- `ProjectDO` deletes expired rows on its sweep alarm.
- Basin Pipelines writes processed event summaries and Outcomes to Basin
  Catalog (Iceberg) in the bucket `nightwatch-archive`. The scheduler
  Worker deletes expired partitions and lets Basin Catalog expire
  snapshots.

### Security mitigations

| Design threat | Mitigation |
|---|---|
| Public Client Key | Ingest routes accept Client Keys only; the api Worker never does. |
| Flood | Rate Limiting binding before `QuotaDO`; refusal before any write. |
| Personal data | Scrubbing runs in `processArrival` before R2 `events/` and before any DO write; `raw/` and K2 are readable only by pumps. |
| Report Reference as bearer | 128 random bits; hashed at rest; revocation deletes the hash row. |
| Contact data to GitHub | The outbound template has no such field; a test asserts it for every outbound path. |
| Forged webhooks | HMAC verification before parse. |
| Forged email replies | HMAC token in the address plus sender match. |
| Cross-tenant | `ProjectDO` ids derive from Project ids; the api Worker resolves the viewer's Projects before any DO call; tests cover search, Follow-up Pages and notices. |
| Stolen Access Token | Stored as hashes in D1; scoped; revocable; optional expiry. |
| Source maps | Artifacts readable only through the api Worker, behind Access. |

---

## Parameters placed

| Design parameter | Carried by |
|---|---|
| Event, Attachment and Arrival size limits | ingest composition root settings, overridable per Project in D1 |
| Quota per category per scope; Report Quota | D1 project config, copied to KV; enforced by `QuotaGate` |
| Retry advice ceiling | ingest composition root settings |
| Raw Retention | K2 stream retention and R2 `raw/` lifecycle rule; both set by IaC |
| Event, Attachment, Report, Outcome, History Retention | `RetentionPolicy` from D1 Organization settings; R2 lifecycle rules; Basin partition expiry |
| Clock-drift clamp | `domain/normalize` settings from the processor composition root |
| New Issue Age, Settle Age, Inbox Expiry | `IssuePolicies`, built by the `ProjectDO` composition root from D1 project config |
| Early Escalation Policy thresholds | `EarlyEscalationPolicy` value in `IssuePolicies` |
| Forecast window and refresh | `ForecastPolicy` value in `IssuePolicies` |
| Auto-Resolve Age | D1 project config |
| Alert Quiet Period, metric window, breach and recovery counts | D1 rule rows |
| Alert Evaluation Delay | effects queue batch timeout and consumer settings |
| Digest Minimum Delay, increment, Maximum Delay | `DigestPolicy`, from notifier settings, overridable per Project |
| Suspect Commit Window | github composition root settings |
| Grouping transition window | D1 project config (current and secondary Grouping Version, end time) |
| Report Reference lifetime | `RetentionPolicy` |
| Spam Judge threshold | `SpamJudge` adapter settings |
| Cron margin, maximum runtime, Uptime interval, failure and recovery counts | D1 monitor rows, read by `MonitorDO` |
| Reply-by-email address lifetime | notifier settings (token expiry) |
| Config propagation lag (introduced here: KV is eventually consistent) | KV cache TTL in ingest settings |
| Dedup window | `ProjectDO` settings |

---

## Operability

| Question | Answer |
|---|---|
| Release class | R3: new components, new data stores, new external dependency (GitHub App), new user population (reporters). |
| Stages and platforms | nonprod and prod, one Cloudflare account each; Workers Paid. K2 and Email Sending are betas gated to Workers Paid. |
| Rollout and rollback | Workers deploy with gradual versions. Durable Object schema changes are expand-contract migrations inside each DO. K2 records and R2 objects are versioned by a schema field. Data written cannot be un-written; rollback is code only. |
| Data warehouse | `nightwatch-ledger` bucket: one NDJSON record per Report Status change and per daily Outcome total per Project, keyed `nightwatch/v1/dt=YYYY-MM-DD/`. Records hold ids and statuses, never messages, contact details or event data. |

### Likeliest failures

| Failure | How it is seen | How it is debugged | Seam or parameter |
|---|---|---|---|
| K2 beta outage or limit (storage cap per account) | ingest 503s; accepted Outcomes drop to zero | Workers Logs on ingest; K2 dashboard | `ArrivalStream`; Raw Retention |
| Pumps fall behind | lag between ingest time and event time grows | pump metric in Analytics Engine; K2 subscription backlog | `StreamPumpDO` count |
| A `ProjectDO` grows hot or large | DO request errors or latency on one Project | DO metrics by id | `IssueStore`; event index capacity |
| Email Sending quota reached | notifier errors; reporter notices delayed | notifier logs; Email Sending dashboard | `Mailer` |
| GitHub sync loop or drift | External Link shows a broken state or flapping | github Worker logs keyed by link | `Tracker`; no-echo record |
| Source maps not applied | events record why mapping failed | event's processing errors | Artifact index |
| Config change not yet seen by ingest | a disabled key still admits data briefly | KV entry age | config propagation lag |

---

## Radar proposals

| Item | Ring | Tier that gates it | Rationale |
|---|---|---|---|
| Cloudflare K2 | Trial | Workers Paid; public beta | The arrival log with retention and replay; behind `ArrivalStream`. |
| Cloudflare Basin (Pipelines, Catalog, SQL) | Trial | Workers Paid | Exact Outcomes and the event archive without hosting an OLAP store. |
| Durable Objects (SQLite) | Adopt | Workers Paid for the volume needed | Per-Project serialized state. |
| D1 | Adopt | Workers Paid | Control plane. |
| R2, Queues, KV, Workflows | Adopt | Workers Paid | Payloads, effects, config cache, long jobs. |
| Analytics Engine | Adopt | none while unbilled | Live, sampled metrics only. |
| Email Sending (`send_email`) | Trial | Workers Paid and an onboarded domain; beta | Reporter and team mail. |
| Email Routing (Email Workers) | Adopt | none | Reply by email. |
| Cloudflare Access | Adopt | Zero Trust seats | Member sign-in; misvtt reporter identity. |
| Turnstile | Adopt | none (free plan) | Anonymous reporter replies. |
| Workers AI | Trial | none for the free allocation | Second `SpamJudge` adapter. |
| Secrets Store | Trial | open beta | GitHub App private key. |
| GitHub App | Adopt | none; works for public and private repositories | Tracker and code host. Nightwatch targets both. |
| `@jridgewell/trace-mapping` (MIT) | Trial | none | Source map lookup in Workers. |
| `postal-mime` (MIT) | Trial | none | Parse inbound replies. |
| `jose` (MIT) | Adopt | none | Access JWT, GitHub App JWT, reporter assertions. |
| `@cloudflare/vitest-pool-workers` (MIT) | Adopt | none | Tests inside the Workers runtime. |

---

## Key Decisions

| Decision | Choice | Rationale | Origin |
|---|---|---|---|
| Arrival log | K2, not Queues | Retention and replay (G2), fan-out, and a record size an event fits in. Queues messages are too small for events. | Drafting; owner named K2 |
| Issue state home | One Durable Object per Project | Serialized writes give one issue per new Fingerprint without locks; Projects shard naturally. | Drafting |
| Control plane | D1 | Relational, low volume, read by many Workers. | Drafting |
| Counters | Exact counters in `ProjectDO`; Analytics Engine only for live charts | Alerts, escalation and Forecasts need exact counts; Analytics Engine samples. | Drafting |
| Outcomes record | Basin Pipelines | Exact and cheap; totals are an archive query, not a request-path query. | Drafting |
| Consumption | `StreamPumpDO` pulling K2 | K2 has no Worker consumer binding; a DO alarm loop is a durable driver. | Drafting |
| Reporter identity for misvtt | Access JWT | misvtt players are already behind Access. | Drafting, from misvtt context |
| Language | TypeScript on Workers | Every runtime here is a Worker. | Drafting |

---

## Open Questions

1. **K2 beta limits.** Storage per account is capped in the beta. Is that
   cap enough at our volume, and when do raised limits arrive?
2. **Basin SQL latency.** It has no Worker binding and no published
   timeout. If Outcome totals are too slow for the UI, a daily roll-up
   into D1 is the fallback.
3. **`ProjectDO` size.** One object holds a Project's event index. If a
   Project outgrows the per-object storage limit, the index shards by
   month into child objects.
4. **Cloudflare Issues.** If the design accepts importing it (design Open
   Question 7), it needs an `ExternalSource` port; it has no public API
   today.

---

## Rejections

| Alternative | Reason |
|---|---|
| Queues as the arrival log | Messages are too small for events, retention is short, and there is no replay of acked messages. |
| D1 for issue state | One database is one writer for every Project; concurrency would need locks. |
| Analytics Engine for alert counts | Sampled; thresholds would fire on estimates. |
| Basin SQL on the request path | No binding and no latency guarantee. |
| Containers for processing | Nothing in scope needs a native runtime; native symbolication is deferred. |
| A `Symbolicator` port now | One mechanism (source maps in Workers) with no second in scope; added with native crashes. |
| Hyperdrive to an external Postgres | Off Cloudflare. |
| Ingest-time clock for cron monitors | Durable Object alarms give a reliable wall clock. |

---

## Related Documents

- [DESIGN.NIGHTWATCH.md](DESIGN.NIGHTWATCH.md) -- the capabilities this
  record delivers.
- [LICENSE.md](../../LICENSE.md) -- clean-room terms.
