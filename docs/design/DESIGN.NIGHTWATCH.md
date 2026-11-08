# Nightwatch

> **Date:** 2026-11-07
> **Authors:** Nine-At-A-Time Media (drafted with AI assistance)
> **Origin:** [docs/concepts/nightwatch/](../concepts/nightwatch/CONCEPT.md)

---

## Overview

Nightwatch captures errors and bug reports from the products we build,
groups them into issues a team can triage, and links those issues to the
code and to GitHub. It also closes the loop with the person who reported
a bug: a reporter with no GitHub access gets a reference and can follow
the report to its outcome. It runs only on Cloudflare, and unmodified
Sentry SDKs can send to it.

Nightwatch is an open-source project and our own code base. It follows
the trail Sentry blazed, as an homage; it borrows no code. It assumes no
hosted deployment: anyone can run it on their own Cloudflare account, and
every behavior in this record can be exercised on a workstation without
one.

---

## Problem and approach

### The problem

| Existing answer | What it gets wrong |
|---|---|
| Self-hosted Sentry | Needs Kafka, ClickHouse, Postgres and Redis. None of these run on Cloudflare. Recent releases are FSL, not open source. |
| Sentry SaaS, PostHog Cloud | Hosted outside Cloudflare. Owner direction is Cloudflare only. |
| Any current feedback widget | The reporter gets a thank-you and nothing else. No reference, no status, no replies. |
| Sentry's GitHub link | One way. Closing the GitHub issue changes nothing in the tracker. |
| Cloudflare Issues | Groups errors from Workers only. No browser capture, no SDK protocol, no feedback. |

Nightwatch must provide the error-tracking feature set those products
provide, on Cloudflare, plus a reporter loop none of them has.

### The approach

- **Accept the existing SDK protocol.** Products keep their Sentry SDKs,
  so instrumentation is already solved.
- **Keep every arrival before processing it.** Processing works from the
  retained arrivals, so a processing bug is fixed by reprocessing them.
- **Group events into issues by deterministic fingerprints.** The same
  crash always lands on the same issue.
- **Treat a bug report as a first-class Report, not as an event.** A
  Report has a reporter, a reference, a status and a conversation.
- **Derive a Report's status from the issue it is attached to.** A team
  member triages issues; reporters see the result without extra work.
- **Sync issue state with GitHub both ways.** Closing on GitHub is a
  triage action in Nightwatch, and reaches the reporter.
- **Partition all state by tenant.** One deployment serves several
  products, and no tenant can read another.
- **Know every reporter.** Every reporter arrives signed in, so a Report
  always has a person and an address to answer.
- **Develop without a host.** Everything runs and is tested locally, so a
  contributor needs no Cloudflare account.

### Tradeoffs

| Given up | Why it is worth it |
|---|---|
| Sentry's server code, which is mature and tuned | It cannot run on Cloudflare, and its licence rules out a commercial service built on it until each release ages. |
| Feature parity on day one (tracing, replay, profiling, native crashes) | The core loop ships first; each deferred product has a seam and its own record later. |
| Arbitrary ad-hoc analytics over every event at request time | Cloudflare has no general OLAP store. Request-path queries are bounded; deep analytics run over the archive. |
| Bit-exact grouping parity with Sentry | Parity would mean copying its grouping rules verbatim. Nightwatch defines its own versioned grouping and honors SDK-supplied fingerprints. |
| Free choice of chat and paging vendors | Email and webhooks first. Each further vendor is a new channel behind one seam. |

---

## Goals

| Id | Goal |
|---|---|
| G1 | An unmodified Sentry SDK (browser, Node, Python, Workers) can send errors, messages, attachments, feedback, sessions and check-ins to Nightwatch by changing only its DSN. |
| G2 | Every accepted arrival is retained unprocessed for a bounded period, and can be reprocessed from that retention. |
| G3 | Each event is assigned to exactly one issue by its fingerprint. The same fingerprint under the same grouping version always yields the same issue. |
| G4 | Minified browser stack traces are shown as original source when the matching source map was uploaded. |
| G5 | Personal data matching a project's scrubbing rules is removed before any person or store other than the raw retention sees it, and each removal is recorded without the value. |
| G6 | Issues follow the lifecycle in State Machine: Issue, including regression, escalation and archive conditions. |
| G7 | A team member can search, assign, comment on, merge, split, delete and discard issues. |
| G8 | Alert rules notify the right people about new, regressed, escalating and frequent issues, and about metric thresholds, within the Alert Evaluation Delay and without duplicate alerts inside the Alert Quiet Period. |
| G9 | A reporter can file a Report from inside a product and receives a Report Reference at filing: shown at once in Nightwatch's report form, and always sent to their address. They can follow the Report to its outcome without a GitHub account. |
| G10 | A reporter is notified when the Report Status changes, and sees only replies a team member marked as shared. |
| G11 | A team member can open a GitHub issue from a Nightwatch issue or Report. State changes on either side reach the other. |
| G12 | A commit or pull request that names an issue resolves it when that commit ships in a release. |
| G13 | Nightwatch suggests an owner for each issue from ownership rules, CODEOWNERS and suspect commits. |
| G14 | Releases, deploys and release health (crash-free sessions and users) are tracked per project and environment. |
| G15 | A monitor raises an issue when a scheduled job misses or fails its check-in, and when a watched URL goes down. |
| G16 | Tenants are isolated: no read, search, notification or link crosses an organization boundary. |
| G17 | Every arrival ends in exactly one recorded Outcome (accepted, filtered, rate limited, invalid, or discarded), and an operator can see the totals. |
| G18 | All stored data expires at the end of its retention window, per kind of data. |
| G19 | Nightwatch runs entirely on Cloudflare. |
| G20 | Nightwatch runs within the Platform Soft Limits. Crossing one alerts the operator within the Platform Usage Interval; it does not by itself refuse data. |
| G21 | Every behavior in this record can be exercised on a workstation with no Cloudflare account and no network access to Cloudflare. |
| G22 | Every Reporter and every Member is identified by the email address their sign-in asserts. Nightwatch accepts no Report from a person who is not signed in. |

---

## Non-Goals

| Non-goal | Cost it defers |
|---|---|
| Tracing and performance monitoring (transactions, spans, performance issues) | Transactions sent by SDKs are counted as Outcomes and dropped. A later record designs them. |
| Session replay | Replay data is dropped. Reports show no recording. |
| Profiling | Profile data is dropped. |
| Native crash symbolication (minidumps, Apple crash reports, debug files) | Native crashes arrive unsymbolicated and group poorly. |
| Machine-learned grouping, similarity or severity | Near-duplicate crashes stay separate issues until merged by hand. |
| Server-side dynamic sampling of traces | Not needed while tracing is out of scope. |
| Dashboards and ad-hoc event queries in the UI | Teams use issue search and fixed charts. Deep analysis goes over the archive with external tools. |
| Issue trackers other than GitHub | Jira and peers wait for demand. |
| Chat and paging channels other than webhooks | Slack, Teams and PagerDuty go through webhooks until each gets a channel. |
| Grouping bit-identical to Sentry | Moving a project from Sentry to Nightwatch creates new issues once. |
| Billing and paid plans | Quotas protect the platform; nobody is charged. |
| Hosting off Cloudflare | Anything that cannot run on Cloudflare is out, by owner direction. |

---

## Design

### Tenancy and access

| Rule | Statement |
|---|---|
| Hierarchy | An Organization holds Teams and Projects. A Project belongs to one or more Teams. |
| Membership | A Member belongs to an Organization with an Organization Role, and to Teams with a Team Role. |
| Permission | A Member's permission on a Project is the union of their Organization Role and their Team Roles on that Project's Teams. |
| Sign-in | Members and Reporters sign in through an issuer the Organization trusts, which asserts their email address. A Reporter need not be a Member. Nightwatch stores no passwords. |
| Trusted sign-in | Only an Organization owner names the sign-in issuers the Organization trusts. A trusted issuer is trusted for every address it asserts. An assertion from any other issuer identifies nobody. |
| Machine access | An Access Token belongs to one Organization and acts only within it. It carries a fixed set of scopes. A CI token can upload release artifacts and do nothing else. |
| Ingest keys | A Client Key admits data to one Project. It grants no read access. It never identifies a reporter. |
| Operator | An Operator runs a deployment. An Operator can reprocess raw arrivals, view Outcome totals and receive Platform Soft Limit alerts. Each Operator action is confined to one Organization, except Platform Usage, which spans the deployment. Reprocessing never shows a raw arrival to the Operator. Being an Operator alone grants no read of a Report, Thread, Attachment or reporter address. |
| Isolation | Every read, search, notification and outbound link is confined to one Organization. |

### Ingest

| Rule | Statement |
|---|---|
| Protocol | Nightwatch accepts the Sentry SDK ingest protocol. Unknown item kinds are counted and dropped. |
| Admission | An arrival is admitted only with an active Client Key for the addressed Project, from an allowed origin when the Project restricts origins. |
| Limits | Every arrival is checked against size limits and Quotas before acceptance. A rejected arrival tells the SDK when to retry, per data category. |
| Filters | Inbound Filters drop known noise (browser extensions, crawlers, localhost, listed releases, listed messages, listed addresses) before processing. |
| Durability | An arrival is acknowledged only after it is durable. |
| Raw retention | Accepted arrivals are retained as received for the Raw Retention window, then expire. |
| Outcomes | Every arrival, accepted or not, produces one Outcome with a reason. |

### Processing

| Rule | Statement |
|---|---|
| Normalization | Each event is validated and normalized. Invalid parts are removed and the removal is recorded on the event. |
| Clock drift | Event times are corrected for the sender's clock drift. Times too far in the future are clamped. Events older than the Event Retention window are rejected. |
| Scrubbing | Scrubbing Rules run before the event is stored or shown. Each removal records the rule and the original length, never the value. |
| Source maps | Browser frames are mapped to original source through Artifacts matched by debug id first, then by release and file name. |
| Release and environment | An event's release and environment are recorded on first sight, per Organization. |
| Idempotence | Processing the same arrival twice yields the same issue assignment and does not double-count. |
| Reprocessing | An operator can reprocess a time range of raw arrivals. Reprocessing replaces derived state for those events and does not duplicate it. It sends no notification, fires no alert action, opens no GitHub issue and applies no Resolution that an earlier processing already caused. |

### Grouping

| Rule | Statement |
|---|---|
| Fingerprint | Each event yields one or more Fingerprints under its project's Grouping Version. |
| Sources | A Fingerprint derives from, in order: an SDK-supplied fingerprint; a project Fingerprint Rule; the exception chain and its in-app frames; the stack trace; the parameterized message. |
| Default token | An SDK or rule fingerprint containing the default token extends the derived Fingerprint instead of replacing it. |
| Stability | Line numbers, memory addresses, build hashes and other volatile parts never contribute to a Fingerprint. |
| Stack Trace Rules | A project can mark frames in-app or out-of-app, and include or exclude frames from grouping, by rule. |
| Assignment | An event joins the issue that already holds any of its Fingerprints. Otherwise it creates a new issue. Concurrent first events with the same Fingerprint create exactly one issue. |
| Versioning | A Grouping Version is immutable. Upgrading a project runs a transition window in which both versions are matched, so existing issues keep their events. |
| Tombstones | A discarded issue leaves a Tombstone. Events with its Fingerprints are dropped with an Outcome until the Tombstone is removed. |

### Issues

| Rule | Statement |
|---|---|
| Identity | Each issue has a short id unique within its Project, readable by people. |
| Summary | Each issue shows its title, culprit, level, Priority, first and last seen, event count, affected-user count, and releases and environments seen. |
| Lifecycle | Status changes follow State Machine: Issue. Every change is recorded in the issue's History. |
| Regression | A resolved issue regresses only when a new event comes from a release newer than its Resolution's release. Events from older releases do not regress it. |
| Escalation | An issue escalates when its event rate exceeds its Forecast. A new issue also escalates early when it is young, already frequent, and well above its project's normal rate. |
| Priority | Initial Priority follows event level. Escalation raises it. A Priority a member sets by hand is never changed automatically. |
| Inbox | New, regressed, escalating and unarchived issues enter the For Review list. Any triage action, or the passage of the Inbox Expiry, removes them. |
| Assignment | An issue has at most one Assignee, a Member or a Team. |
| Ownership | Ownership Rules map paths, modules, URLs and tags to owners. The last matching rule wins. Ownership Rules outrank CODEOWNERS. |
| Merge | Merging moves every Fingerprint, event, count, comment and Report of the source issues to one target issue. A merge completes entirely or not at all. |
| Split | Splitting moves the events of chosen Fingerprints to a new issue. Events that arrive during a split land in the new issue. A split completes entirely or not at all. |
| Delete | Deleting an issue removes it and its events. |
| Discard | Discarding deletes the issue and creates a Tombstone. |
| Auto-resolve | A Project may resolve issues not seen for its Auto-Resolve Age. |
| Search | Issues are searched by a query language over status, substatus, assignee, owner, Priority, release, environment, tags, age, counts, Report presence and free text. Members can save searches. |

### Reports

A Report is a bug report a person filed. It is not an event.

| Rule | Statement |
|---|---|
| Filing | A signed-in reporter files a Report with a message, which is the only field they must provide. A screenshot and an associated event are optional. |
| Identity | The reporter's identity and address come from their sign-in. Nightwatch never asks for them. |
| Reference | Every Report gets a Report Reference at filing. The reference is shown to the reporter at once when Nightwatch's own report form is used, and is always sent to the reporter's address. A reference whose Report expired, was revoked or was erased behaves as an unknown reference. |
| Attachment | Every Report is attached to exactly one issue. A new Report starts on its own Report issue. When the Report names an associated event, its issue is linked as related evidence. |
| Duplicates | A team member can move a Report to another issue. All Reports on an issue share that issue's outcome. |
| Status | A Report's Report Status is derived from the state of the issue it is attached to alone, as in State Machine: Report. |
| Follow-up Page | The Follow-up Page for a Report Reference shows the Report Status, the shared Thread and the dates of each change, and nothing else about the issue. Only the Report's reporter and Members of its Project can open it. |
| My reports | A reporter can list all of their own Reports in an Organization, each with its Report Reference. |
| Thread | Each Report has a Thread. A team member's comment enters the Thread only when it is marked shared. A reporter's reply always enters the Thread and is shown to the team. |
| Notification | A Reporter Notification is sent on each Report Status change and each shared comment, to a reporter who has not unsubscribed. |
| Spam | A Report judged spam, by a team member or by the Spam Judge, is archived. Its reporter is told nothing and its Follow-up Page does not change. Archiving is the Spam Judge's only effect. |
| Evidence | A team member sees the Report's message, screenshot, associated event, product context, and any session the SDK linked. |
| Quota | Report filing has its own Quota per Project. |

### Alerts and notifications

| Rule | Statement |
|---|---|
| Issue Alert Rule | A rule has triggers (first seen, regression, unarchived, escalating, every event, event frequency, user frequency), filters (environment, level, tag, attribute, age, assignee, release, issue kind) and actions (email to owners, a team or a member; webhook; open a GitHub issue). |
| Throttle | A rule fires at most once per issue within its Alert Quiet Period. |
| Outbound actions | An Issue Alert Rule opens at most one GitHub issue per Nightwatch issue. A repeated webhook delivery carries the same identity as the first, so its receiver can tell it is a repeat. |
| Delay | A trigger that needs a count fires within the Alert Evaluation Delay of the event that satisfied it. |
| Digest | Issue alert emails to one recipient for one rule are gathered into a Digest. A Digest is sent no sooner than the Digest Minimum Delay after its first item and no later than the Digest Maximum Delay. |
| Metric Alert Rule | A rule watches an aggregate (event count, user count, crash-free rate) over a window, with a critical and an optional warning threshold. It opens an Incident after a set number of consecutive breaches, and resolves it after a set number of consecutive recoveries. |
| Subscriptions | Members follow issues they commented on, were assigned, or were mentioned in. Followers receive Workflow Notifications about those issues. |
| Settings | A Member can set each notification kind to always, never, or followed-only, per Organization and per Project. The Project setting wins. |
| Reply by email | A reply to an issue notification email becomes a comment on the issue by the replying Member only when its sender is authenticated as that Member's address. Any other reply is dropped. |
| Threading | All emails about one issue thread together in the recipient's mail client. |

### Code and GitHub

| Rule | Statement |
|---|---|
| Install | An Organization connects one or more GitHub accounts through an installed GitHub app, and chooses the repositories Nightwatch may use. |
| Open | A team member opens a GitHub issue from a Nightwatch issue or Report, with evidence filled in. An Issue Alert Rule can do the same. |
| Link | A team member links a Nightwatch issue to an existing GitHub issue. |
| Two-way state | Closing a linked GitHub issue as completed resolves the Nightwatch issue. Closing it as not planned archives the issue forever. Reopening it unresolves the issue. Resolving or reopening in Nightwatch closes or reopens the GitHub issue. The Nightwatch issue alone decides Report Status. A GitHub write that fails does not undo the Nightwatch change; it counts toward the External Link becoming Broken. |
| Comments | A GitHub comment marked for the reporter enters the Report Thread as shared. A reporter's reply is posted to the GitHub issue without the reporter's contact details. |
| Resolve by reference | A commit or pull request whose message says it fixes an issue's short id resolves that issue with a pending commit Resolution. The Resolution completes when the commit ships in a release. |
| Commits | Commits for a release are recorded from push events or from the range between two releases. |
| Suspect commit | The commit that last changed the topmost in-app frame's line, within the Suspect Commit Window, is named the Suspect Commit. Its author is a suggested owner. |
| Code links | A stack frame links to its line in the repository through a Code Mapping. |
| CODEOWNERS | A repository's CODEOWNERS file maps to suggested owners, through account mappings between GitHub and Nightwatch. |

### Releases and monitors

| Rule | Statement |
|---|---|
| Release | A release is identified by version within an Organization. Versions that parse as semantic versions order by version; others order by first sight. |
| Deploy | A deploy records a release reaching an environment at a time. |
| Artifacts | CI uploads source maps and bundles to a release or by debug id. Uploads are deduplicated by content. |
| Release health | Sessions from SDKs yield crash-free session and user rates per release and environment. |
| Cron Monitor | A Cron Monitor has a schedule, a check-in margin and a maximum runtime. A missed, late, failed or overlong run is a Failure. |
| Uptime Monitor | An Uptime Monitor checks a URL on an interval. Consecutive failures past the Uptime Failure Count are a Failure. |
| Monitor issues | A run of consecutive Failures past the monitor's failure threshold opens a monitor issue. A run of consecutive successes past its recovery threshold resolves it. |

### Retention and data handling

| Rule | Statement |
|---|---|
| Windows | Raw arrivals, events, attachments, Reports, History and Outcomes each have their own retention window. |
| Expiry | Data past its window is unreadable and is then deleted. |
| Order | Raw Retention is never longer than Event Retention. A Report outlives the events it cites, and loses its evidence when they expire. |
| Export | An Organization owner can export a Project's issues and Reports. |
| Erasure | An Organization owner can erase a reporter's Reports and contact details on request. Erasure reaches the reporter's Reports, their Threads and Attachments, their Report References, pending Reporter Notifications, and the reporter's address wherever Nightwatch holds it, including raw retention, History and the archive. |
| Archive | Processed events are archived for analysis by tools outside Nightwatch. The archive obeys Event Retention. |

---

## Behaviors

### Ingest

| Behavior | Given / When / Then |
|---|---|
| An SDK event is accepted | Given an active Client Key, When an SDK sends an error, Then Nightwatch acknowledges it and records an accepted Outcome. |
| A disabled key is refused | Given a disabled Client Key, When an SDK sends an error, Then Nightwatch refuses it and records an invalid Outcome. |
| A wrong origin is refused | Given a Project that restricts origins, When a browser sends from another origin, Then Nightwatch refuses it. |
| An oversized arrival is refused | Given an arrival over a size limit, When it is sent, Then Nightwatch refuses it and records an invalid Outcome. |
| A quota rejects with retry advice | Given a Quota is exhausted for a category, When an SDK sends that category, Then Nightwatch refuses it, tells the SDK when to retry that category, and records a rate-limited Outcome. |
| Noise is filtered | Given an Inbound Filter matches an event, When it arrives, Then it is not processed and a filtered Outcome records the filter. |
| Out-of-scope data is counted | Given an arrival of a kind in Non-Goals, When it arrives, Then it is dropped with an Outcome and no error reaches the SDK. |
| Durable before acknowledged | Given storage is unavailable, When an SDK sends, Then Nightwatch refuses with retry advice and does not acknowledge. |

### Processing and grouping

| Behavior | Given / When / Then |
|---|---|
| Same crash, same issue | Given an issue holds a Fingerprint, When another event with that Fingerprint arrives, Then it joins that issue and the count rises by one. |
| New crash, new issue | Given no issue holds an event's Fingerprints, When it is processed, Then a new issue is created with status New. |
| Concurrent first events | Given two events with the same new Fingerprint, When they are processed at once, Then exactly one issue exists afterwards and holds both. |
| SDK fingerprint wins | Given an event carries an SDK fingerprint without the default token, When it is processed, Then grouping uses only that fingerprint. |
| Default token extends | Given an SDK fingerprint with the default token and a value, When processed, Then the event groups apart from events with the default Fingerprint alone. |
| Volatile parts ignored | Given two events differing only in line numbers, When processed, Then they join the same issue. |
| Tombstoned events dropped | Given a Tombstone holds a Fingerprint, When an event with it arrives, Then it is dropped with a discarded Outcome. |
| Duplicate arrival | Given an arrival was already processed, When it is processed again, Then no count changes and no new issue appears. |
| Source map applied | Given a matching Artifact was uploaded, When a minified browser error is processed, Then its frames show original file, line and function. |
| Missing source map | Given no matching Artifact, When a minified error is processed, Then frames stay minified and the event records why. |
| Scrubbing removes data | Given a Scrubbing Rule matches a field, When the event is processed, Then the stored event shows the field as removed with the rule and length, and no store other than raw retention holds the value. |
| Reprocess a range | Given raw arrivals in a time range, When an operator reprocesses it, Then the derived events are rebuilt once, and counts equal a single processing. |
| Interrupted reprocess | Given an operator's reprocess of a range, When it stops before finishing, Then the range holds either its prior derived state or its fully rebuilt state, never a mix, and the operator is told it did not finish. |
| Reprocessing is silent | Given a range whose events already caused alerts, Reporter Notifications and GitHub issues, When an operator reprocesses it, Then none of them is sent, fired or opened again. |
| Raw retention expired | Given an arrival older than Raw Retention, When an operator asks to reprocess it, Then Nightwatch refuses and says it has expired. |

### Issues

| Behavior | Given / When / Then |
|---|---|
| New becomes ongoing | Given a New issue, When it is older than the New Issue Age, Then it becomes Ongoing. |
| Early escalation | Given a young issue that is frequent and well above its project's normal rate, When another event arrives, Then it becomes Escalating and its Priority rises. |
| Archived until escalating | Given an issue archived until escalating, When its rate over the Forecast Window exceeds its Forecast, Then it becomes Escalating and enters For Review. |
| Archived until condition | Given an issue archived until a count, user count or date, When the condition is met, Then it becomes Ongoing. |
| Archived forever stays | Given an issue archived forever, When events arrive, Then it stays archived and counts rise. |
| Regression in newer release | Given an issue resolved in release R, When an event from a release newer than R arrives, Then it becomes Regressed. |
| No regression from older release | Given an issue resolved in release R, When an event from a release older than R arrives, Then it stays resolved. |
| Resolve in next release | Given an issue resolved in next release, When the next release is first seen, Then the Resolution names that release. |
| Hand-set priority sticks | Given a member set an issue's Priority, When the issue escalates, Then its Priority does not change. |
| Merge | Given two issues, When a member merges them, Then one issue holds all Fingerprints, events, counts, comments and Reports. |
| Split | Given an issue with two Fingerprints, When a member splits one off, Then a new issue holds that Fingerprint's events, including events that arrived during the split. |
| Discard | Given an issue, When a member discards it, Then the issue is gone and future events with its Fingerprints are dropped. |
| Auto-resolve | Given a Project with an Auto-Resolve Age, When an issue is not seen for that age, Then it is resolved. |
| Owner suggested | Given an Ownership Rule matches an event's path, When the issue is created, Then the rule's owner is suggested, and assigned when the Project auto-assigns. |
| Search | Given issues in several states, When a member searches `is:unresolved assigned:me release:latest`, Then only matching issues in that member's Organization are returned. |
| Cross-tenant search | Given issues in two Organizations, When a member of one searches, Then no issue from the other is returned. |

### Reports

| Behavior | Given / When / Then |
|---|---|
| Report filed in Nightwatch's form | Given a reporter in a product using Nightwatch's report form, When they submit a message, Then they see a Report Reference at once. |
| Report filed through an SDK widget | Given a signed-in reporter using a Sentry SDK feedback widget, When they submit, Then a Reporter Notification with the Report Reference is sent to their address. |
| Reporter not asked who they are | Given a signed-in reporter, When the form opens, Then it asks for no name and no address. |
| Unsigned report refused | Given a submission that carries no sign-in from a trusted issuer, When it is submitted, Then no Report is filed and an invalid Outcome is recorded. |
| Empty message refused | Given a message that is empty, When the reporter submits, Then the Report is not filed and the form says why. |
| Failed send is visible | Given Nightwatch is unreachable, When the reporter submits in Nightwatch's form, Then the form says the Report was not sent. |
| Follow-up Page shows status | Given a Report Reference, When its reporter opens its Follow-up Page, Then they see the Report Status, the shared Thread and change dates, and nothing else about the issue. |
| Follow-up Page refuses others | Given a Report Reference, When a signed-in person who is neither its reporter nor a Member of its Project opens it, Then the page says it was not found. |
| Unknown reference | Given a reference that does not exist or was revoked, When its Follow-up Page is opened, Then the page says it was not found and reveals nothing else. |
| Status change notifies | Given a Report whose reporter is subscribed, When its issue is resolved, Then the reporter is notified that the Report is Fixed. |
| Fix ships | Given a Fixed Report, When the resolving release is seen, Then the Report Status becomes Released and the reporter is notified. |
| Regression reopens a Report | Given a Fixed or Released Report, When its issue becomes Unresolved/Regressed, Then the Report Status becomes Acknowledged and the reporter is notified. |
| Shared reply reaches reporter | Given a team member comments and marks it shared, When the comment is saved, Then it appears in the Thread and the reporter is notified. |
| Private comment stays private | Given a team member comments without marking it shared, When the comment is saved, Then the reporter is told nothing and the Thread does not change. |
| Reporter reply reaches team | Given a Report Thread, When the reporter replies, Then the reply appears on the issue for the team, and on the linked GitHub issue without contact details. |
| Duplicate reports share outcome | Given two Reports moved onto one issue, When that issue is resolved, Then both Reports become Fixed and both reporters are notified. |
| Spam is silent | Given a Report, When it is marked spam, Then it is archived, its reporter is told nothing, and its Follow-up Page does not change. |
| Unsubscribe | Given a reporter who unsubscribed from a Report, When its status changes, Then no Reporter Notification is sent. |
| My reports | Given a signed-in reporter, When they open their report list, Then they see all and only their own Reports in that Organization, each with its Report Reference. |
| Report quota | Given the Report Quota for a Project is exhausted, When a Report is submitted, Then it is refused with retry advice and an Outcome. |

### Alerts and notifications

| Behavior | Given / When / Then |
|---|---|
| New issue alert | Given a rule triggering on first seen, When a new issue is created, Then its actions run once. |
| Quiet period | Given a rule fired for an issue, When the trigger is met again inside the Alert Quiet Period, Then the actions do not run. |
| Frequency alert | Given a rule triggering on more than N events in a window, When the Nth plus one event arrives, Then the actions run within the Alert Evaluation Delay. |
| Filter blocks | Given a rule filtered to environment production, When a staging event meets the trigger, Then the actions do not run. |
| Digest gathers | Given several alerts for one recipient and rule in a burst, When the Digest is due, Then one email lists them all. |
| Undelivered alert is visible | Given an Issue Alert Rule whose email or webhook action cannot be delivered, When Nightwatch stops trying, Then Members see on the rule that the action was not delivered. |
| Metric incident opens and closes | Given a metric rule, When its aggregate breaches for the required consecutive windows, Then an Incident opens; When it recovers for the required windows, Then the Incident closes, and each change notifies. |
| Reply by email | Given an issue notification email, When a Member replies, Then the reply becomes their comment on the issue. |
| Unknown replier | Given an issue notification email, When an address that is not a Member replies, Then nothing is posted. |
| Settings respected | Given a Member set workflow notifications to never for a Project, When an issue they follow there changes, Then they are not emailed. |

### Code and GitHub

| Behavior | Given / When / Then |
|---|---|
| Open GitHub issue | Given a connected repository, When a member opens a GitHub issue from a Nightwatch issue, Then the GitHub issue exists with evidence and the External Link is recorded. |
| GitHub close resolves | Given a linked issue, When the GitHub issue is closed as completed, Then the Nightwatch issue is resolved and its Reports become Fixed. |
| GitHub not-planned closes report | Given a linked issue, When the GitHub issue is closed as not planned, Then the Nightwatch issue is archived forever and its Reports become Closed. |
| GitHub reopen | Given a linked resolved issue, When the GitHub issue is reopened, Then the Nightwatch issue is unresolved and its Reports become Acknowledged. |
| Nightwatch resolve closes GitHub | Given a linked issue, When a member resolves it in Nightwatch, Then the GitHub issue is closed. |
| GitHub refuses a close | Given a linked issue, When a member resolves it and GitHub refuses the close, Then the Nightwatch issue stays resolved, its Reports become Fixed, and the refusal counts toward the External Link becoming Broken. |
| No echo | Given a state change that came from GitHub, When Nightwatch applies it, Then Nightwatch does not send the same change back to GitHub. |
| Shared GitHub comment | Given a linked issue with Reports, When a GitHub comment is marked for the reporter, Then it enters each Report's Thread as shared. |
| Contact never leaves | Given a Report, When anything is posted to GitHub, Then the reporter's address is absent. |
| Resolve by commit | Given an issue with short id S, When a commit saying it fixes S is pushed, Then the issue is resolved pending that commit; When the commit ships in a release, Then the Resolution names that release. |
| Suspect commit | Given a code mapping and an in-app top frame, When an issue is created, Then the Suspect Commit and its author are shown. |
| Uninstalled app | Given a GitHub installation is removed, When a linked issue changes, Then Nightwatch records that the link is broken and does not retry forever. |
| Broken link relinked | Given a Broken External Link, When the installation is restored and a member relinks, Then the External Link is Linked again and later changes on either side reach the other. |

### Releases and monitors

| Behavior | Given / When / Then |
|---|---|
| Artifact upload | Given a CI token, When CI uploads a source map for a release, Then later events of that release are mapped with it. |
| CI token cannot read | Given a CI token, When it asks for issues, Then it is refused. |
| Crash-free rate | Given sessions for a release, When a member opens the release, Then crash-free session and user rates are shown. |
| Missed check-in | Given a Cron Monitor, When no check-in arrives by its expected time plus margin, Then a missed Failure is recorded. |
| Overlong run | Given a run in progress, When it exceeds its maximum runtime, Then a timeout Failure is recorded. |
| Monitor issue opens and resolves | Given consecutive Failures past the threshold, When the last is recorded, Then a monitor issue opens; When consecutive successes pass the recovery threshold, Then it resolves. |
| URL down | Given an Uptime Monitor, When checks fail past the Uptime Failure Count, Then a monitor issue opens. |

### Operating

| Behavior | Given / When / Then |
|---|---|
| Outcome totals | Given arrivals of every Outcome kind, When an operator views Outcomes for a Project, Then totals per kind and reason are shown. |
| Retention expiry | Given an event older than Event Retention, When anyone asks for it, Then it is not found. |
| Erasure | Given a reporter's erasure request, When an owner erases it, Then that reporter's Reports and contact details are gone and their Follow-up Pages say not found. |
| Erasure reaches every store | Given a reporter whose address and Reports are held in raw retention, History, the archive and pending Reporter Notifications, When an owner erases them, Then none of those holds the address or the Reports; if any cannot be erased, the owner is told the erasure is incomplete. |
| Noisy tenant | Given one Project floods ingest, When its Quota is exhausted, Then other Projects' arrivals are still accepted. |
| Soft limit crossed | Given Platform Usage above its Platform Soft Limit, When usage is compared, Then the operator is alerted and no Arrival is refused for that reason. |

---

## State Machine

### Issue

```
                               first event
                                    |
                                    v
+------------------------------- UNRESOLVED -------------------------------+
|                                                                          |
|  NEW ------------------(New Issue Age)---------------------> ONGOING     |
|   |                                                          ^      ^    |
|   +--(Early Escalation Policy)--> ESCALATING --(Settle Age)--+      |    |
|                                                                     |    |
|                                   REGRESSED --(Settle Age)----------+    |
|                                                                          |
+--------------------------------------------------------------------------+
       |                                          |
       | resolve: member, commit,                 | archive: member;
       | GitHub close as completed,               | to FOREVER also by spam
       | auto-resolve                             | or GitHub close as not planned
       v                                          v
   RESOLVED                                   ARCHIVED/UNTIL_ESCALATING
    |                                         ARCHIVED/UNTIL_CONDITION
    +--(Regression Policy)--> REGRESSED       ARCHIVED/FOREVER
    +--(member, GitHub reopen)--> ONGOING

   ARCHIVED/UNTIL_ESCALATING --(rate over Forecast Window
                                exceeds Forecast)----------> ESCALATING
   ARCHIVED/UNTIL_CONDITION  --(condition met)--------------> ONGOING
   ARCHIVED/*                --(member, GitHub reopen)------> ONGOING

   any --(member delete)--> DELETING --> gone
   any --(member discard)--> DELETING --> gone, Tombstone kept
   any --(member merge, as a source)--> MERGING --> gone into target
```

| From | To | Trigger | Condition |
|---|---|---|---|
| (none) | Unresolved/New | first event of a Fingerprint | no issue or Tombstone holds it |
| Unresolved/New | Unresolved/Ongoing | sweep | older than New Issue Age |
| Unresolved/New | Unresolved/Escalating | event | Early Escalation Policy holds |
| Unresolved/Escalating | Unresolved/Ongoing | sweep | in state longer than Settle Age |
| Unresolved/Regressed | Unresolved/Ongoing | sweep | in state longer than Settle Age |
| Unresolved/* | Resolved | member, commit, GitHub close as completed, auto-resolve | none |
| Unresolved/* | Archived/Until escalating | member | none |
| Unresolved/* | Archived/Until condition | member | a count, user count or date is given |
| Unresolved/* | Archived/Forever | member, spam, GitHub close as not planned | none |
| Archived/Until escalating | Unresolved/Escalating | event | rate over the Forecast Window exceeds Forecast |
| Archived/Until condition | Unresolved/Ongoing | event or sweep | condition met |
| Archived/* | Unresolved/Ongoing | member, GitHub reopen | none |
| Resolved | Unresolved/Regressed | event | Regression Policy holds |
| Resolved | Unresolved/Ongoing | member, GitHub reopen | none |
| any | Deleting | member delete or discard | none |
| any | Merging | member merge, as a source | none |

### Report Status

A Report Status is derived; nothing sets it directly. Each arrow below is
a change in the attached issue that moves the derived status.

```
  RECEIVED --+--(issue acknowledged)------------> ACKNOWLEDGED
             +--(issue resolved)----------------> FIXED
             +--(issue archived forever)--------> CLOSED

  ACKNOWLEDGED --(issue resolved)---------------> FIXED
  ACKNOWLEDGED --(issue archived forever)-------> CLOSED
  FIXED        --(Resolution's release seen)----> RELEASED
  FIXED, RELEASED --(issue regressed, reopened)--> ACKNOWLEDGED
  CLOSED       --(issue reopened)---------------> ACKNOWLEDGED

  any --(issue archived forever as spam)--> (no visible change)
```

| Report Status | Holds when the attached issue is... |
|---|---|
| Received | Unresolved/New, with no Assignee, no member comment and no External Link. |
| Acknowledged | Unresolved and either past New or holding an Assignee, a member comment or an External Link; or Archived until escalating or until condition. |
| Fixed | Resolved, and its Resolution names no release that has been seen. |
| Released | Resolved, and its Resolution's release has been seen. |
| Closed | Archived forever and not spam. |
| (unchanged) | Archived forever as spam: the reporter keeps seeing the last status shown. |

Every change of Report Status is a Reporter Notification, except where
the reporter unsubscribed or the Report is spam.

### External Link

| From | To | Trigger |
|---|---|---|
| (none) | Linked | issue opened or linked on GitHub |
| Linked | Linked | state or comment synced in either direction |
| Linked | Broken | installation removed, repository removed, or GitHub refuses repeatedly |
| Broken | Linked | installation restored and a member relinks |
| Linked | (none) | member unlinks |

### Cron and Uptime Monitor

| From | To | Trigger |
|---|---|---|
| OK | Failing | Failure recorded, count below threshold |
| Failing | Incident | consecutive Failures reach the failure threshold; a monitor issue opens |
| Incident | Recovering | success recorded, count below recovery threshold |
| Recovering | OK | consecutive successes reach the recovery threshold; the monitor issue resolves |
| Failing, Recovering | OK, Incident | the run of results breaks |

### Metric Incident

| From | To | Trigger |
|---|---|---|
| Closed | Warning or Critical | consecutive breaches of that threshold |
| Warning | Critical | consecutive breaches of the critical threshold |
| Critical | Warning | consecutive values below critical and above warning |
| Warning, Critical | Closed | consecutive values past the resolve threshold, or a member closes it |

---

## Domain Language

| Term | Meaning | Invariant |
|---|---|---|
| Organization | A tenant. | Nothing is shared across Organizations. |
| Team | A group of Members within an Organization. | Belongs to one Organization. |
| Project | One product's error and report space. | Belongs to one Organization and one or more Teams. |
| Member | A person in an Organization. | Has one Organization Role. |
| Organization Role, Team Role | A named set of scopes. | Permission is the union of a Member's roles. |
| Operator | The person who runs a Nightwatch deployment. | Acts within one Organization at a time, except on Platform Usage; as Operator alone, never reads a raw arrival, Report, Thread, Attachment or reporter address. |
| Access Token | A credential for the Nightwatch API with fixed scopes. | Belongs to one Organization; never admits ingest. |
| Client Key | A credential that admits ingest to one Project. | Grants no read access; never identifies a Reporter. |
| Arrival | One ingest request as received. | Has exactly one Outcome. |
| Outcome | The recorded fate of an Arrival or one of its items: accepted, filtered, rate limited, invalid, or discarded, with a reason. | Every Arrival yields Outcomes that sum to what it carried. |
| Quota | A bound on Arrivals per category per scope per window. | Exhausting one Project's Quota never refuses another Project. |
| Inbound Filter | A Project rule that drops matching Arrivals before processing. | A filtered Arrival is never processed. |
| Raw Retention | The window an accepted Arrival is kept as received. | Never longer than Event Retention. |
| Event Retention | The window an Event is kept after it occurs. | Set per Organization; the archive obeys it. |
| Event | One error or message occurrence after processing. | Belongs to exactly one issue. |
| Attachment | A file sent with an Event or Report. | Lives and expires with its parent. |
| Scrubbing Rule | A Project rule that removes matching personal data. | The removed value is never stored outside raw retention. |
| Artifact | An uploaded source map or bundle. | Matched by debug id before release and file name. |
| Fingerprint | A stable identifier derived from an Event under a Grouping Version. | Equal Fingerprints under one version mean one issue. |
| Grouping Version | A named, immutable set of grouping rules. | Never edited once released. |
| Fingerprint Rule, Stack Trace Rule | Project rules that change how Fingerprints derive. | Changing them affects only later Events. |
| Issue | A group of Events sharing a Fingerprint, with a status. | Holds at least one Fingerprint or one Report. |
| Report issue | An Issue created to hold a new Report. | Holds no Fingerprint until merged with a crash Issue. |
| Short Id | The human-readable id of an Issue. | Unique within its Project, never reused. |
| Status, Substatus | An Issue's place in State Machine: Issue. | Changes only by the listed transitions. |
| New Issue Age | The age after which a New Issue becomes Ongoing. | Applies only to New Issues. |
| Settle Age | The time an Issue stays Escalating or Regressed before it returns to Ongoing. | Applies only to those two substatuses. |
| Resolution | The record of how an Issue was resolved: plain, in a release, in the next release, or in a commit. | Decides regression. |
| Regression Policy | The rule deciding whether an Event regresses a resolved Issue. | An Event from a release not newer than the Resolution's never regresses it. |
| Forecast | The expected ceiling on an Issue's event rate over the Forecast Window. | Recomputed on a schedule from recent history. |
| Forecast Window | The span over which an Issue's event rate is compared with its Forecast. | The same span for the rate and the Forecast it is compared with. |
| Early Escalation Policy | The rule escalating a young, frequent Issue. | Applies only within the New state. |
| Priority | Low, medium or high. | A hand-set Priority is never changed automatically. |
| For Review | The list of Issues awaiting triage. | An Issue leaves it on any triage action or at Inbox Expiry. |
| Inbox Expiry | The time after which an untriaged Issue leaves For Review. | Leaving by expiry changes no Status. |
| Auto-Resolve Age | The time unseen after which a Project resolves an Issue. | Unset means never. |
| Assignee | The one Member or Team responsible for an Issue. | At most one. |
| Ownership Rule | A Project rule mapping a match to owners. | The last match wins and outranks CODEOWNERS. |
| Tombstone | The kept Fingerprints of a discarded Issue. | Events matching it are dropped. |
| History | The append-only record of an Issue's changes. | Never edited, except by Erasure. |
| Report | A bug report a person filed. | Attached to exactly one Issue. |
| Reporter | The person who filed a Report. | Always identified by the email address a trusted sign-in asserts; need not be a Member. |
| Assertion | A claim of a person's identity, presented with a request and not yet verified. | Identifies nobody until verified. |
| Sign-in | A verified Assertion of a person's email address by an issuer the Organization trusts. | Without one, a request identifies nobody. |
| Report Reference | The handle a Reporter uses to follow a Report. | Cannot be guessed; revocable; grants nothing without a sign-in; behaves as unknown once its Report expires. |
| Report Status | Received, Acknowledged, Fixed, Released, or Closed. | Derived from the attached Issue; never set directly. |
| Follow-up Page | The Reporter's view of one Report. | Shows Report Status, shared Thread and dates only. |
| Thread | The conversation on one Report. | A team comment enters it only when marked shared. |
| Reporter Notification | A message to a Reporter about their Report. | Never sent to an unsubscribed Reporter or for spam. |
| Spam Judge | The judgement of whether a Report is spam. | Its verdict can be overturned by a Member; archiving is its only effect. |
| Issue Alert Rule | Triggers, filters and actions over Issues. | Fires at most once per Issue per Alert Quiet Period. |
| Alert Quiet Period | The span after an Issue Alert Rule fires for an Issue in which it does not fire again for that Issue. | Set per rule; bounded below. |
| Alert Evaluation Delay | The longest time between the event that satisfies a counting trigger and the rule firing. | Bounded. |
| Metric Alert Rule | Thresholds over an aggregate. | Opens and closes Incidents only on consecutive windows. |
| Incident | A period during which a Metric Alert Rule is breached. | Has one current level. |
| Digest | A gathered set of alert emails for one recipient and rule. | Sent within the Digest Minimum and Maximum Delay. |
| Digest Minimum Delay, Digest Maximum Delay | The earliest and latest a Digest is sent after its first item. | The Minimum is below the Maximum. |
| Workflow Notification | A message to an Issue's followers about a change. | Respects the follower's settings. |
| External Link | The tie between an Issue and a GitHub issue. | A change that came from one side is not echoed back to it. |
| Code Mapping | The tie between a stack path prefix and a repository path. | Belongs to one Project and one repository. |
| Suspect Commit | The commit most likely to have caused an Issue. | Chosen within the Suspect Commit Window. |
| Suspect Commit Window | The span of history searched for a Suspect Commit. | No commit outside it is named. |
| Release | A version of a product within an Organization. | Versions order semantically when they parse, else by first sight. |
| Deploy | A Release reaching an Environment. | Has a time. |
| Environment | A named place a product runs, such as production. | Belongs to one Organization. |
| Repository | A code repository an Organization connected for Nightwatch to use. | Reached only through the Organization's installed GitHub app. |
| Session | One use of a product, as reported by an SDK. | Ends in one of ok, exited, errored, crashed or abnormal. |
| Cron Monitor, Uptime Monitor | Watchers that record successes and Failures. | Open and resolve monitor issues only on consecutive runs. |
| Uptime Failure Count | The number of consecutive failed checks that make an Uptime Monitor Failure. | Set per monitor; at least one. |
| Failure | A missed, late, failed, overlong or down result. | Recorded once per expected run. |
| Platform Usage | Use of one Cloudflare product against its Platform Soft Limit. | Compared within the Platform Usage Interval. |
| Normalized Event | An Event after validation and clock-drift correction, before scrubbing. | Invalid parts are absent and listed as Event Errors. |
| Event Error | A part of an Event that was dropped, clamped or could not be mapped, with the reason. | Never carries the dropped value. |
| Frame | One call in a stack trace: module or file, function, position, and whether it is in-app. | Positions never contribute to a Fingerprint. |
| Grouping Input | The facts grouping reads from a Normalized Event. | Holds no value a Scrubbing Rule removed. |
| Removal | The record that a Scrubbing Rule removed a field: its path, the rule, the method and the original length. | Never holds the removed value. |
| Snooze Condition | The date, count or user count that unarchives an Issue archived until a condition. | Any one condition met unarchives it. |
| Report Status Change | One change of a Report's shown Report Status, with its date. | Appears on the Follow-up Page. |
| Platform Soft Limit | The usage of one Cloudflare product above which the operator is alerted. | Crossing it never by itself refuses an Arrival. |
| Platform Usage Interval | How often Platform Usage is compared with its Platform Soft Limit. | Bounds how late a crossing is reported. |

---

## Parameters

| Parameter | Constraint |
|---|---|
| Event size limit, Attachment size limit, Arrival size limit | Each bounded; an SDK's own defaults must fit under them. |
| Quota per category per scope | Bounded per Project and per Client Key; per-Organization optional. |
| Retry advice ceiling | Bounded; never longer than a Quota window. |
| Raw Retention | Bounded; never longer than Event Retention. |
| Event Retention | Bounded; per Organization. |
| Attachment Retention | Never longer than Event Retention. |
| Report Retention | At least Event Retention. |
| Outcome Retention, History Retention | Bounded. |
| Clock-drift clamp | Bounded future skew tolerated before clamping. |
| New Issue Age | Bounded. |
| Settle Age | Bounded; Escalating and Regressed return to Ongoing after it. |
| Early Escalation Policy thresholds | Young-age bound, minimum event count, rate multiple over project normal. |
| Forecast window and refresh | The history window and the refresh interval are bounded. |
| Inbox Expiry | Bounded. |
| Auto-Resolve Age | Optional per Project; unset means never. |
| Alert Quiet Period | Per rule; bounded below. |
| Alert Evaluation Delay | Bounded; frequency triggers fire within it. |
| Digest Minimum Delay, Digest Maximum Delay | Minimum below Maximum. |
| Metric alert window, consecutive breach count, consecutive recovery count | Per rule; counts at least one. |
| Suspect Commit Window | Bounded. |
| Grouping transition window | Bounded; both versions match during it. |
| Report Quota | Per Project; separate from event Quotas. |
| Report Reference lifetime | At least Report Retention, unless revoked or erased. |
| Spam Judge threshold | A verdict below it never archives a Report automatically. |
| Cron check-in margin, maximum runtime | Per monitor. |
| Uptime interval, Uptime Failure Count, recovery count | Per monitor. |
| Monitor failure and recovery thresholds | Per monitor; at least one. |
| Platform Soft Limits | One per Cloudflare product used. Each equals that product's free-plan allocation, or its beta allocation where the product has no free plan. |
| Platform Usage Interval | Bounded. |

---

## Security Considerations

| Threat | Constraint it imposes |
|---|---|
| A Client Key is public (it ships in browser code) | A Client Key admits ingest only. It reads nothing and never identifies a reporter; a Report's reporter comes only from a Sign-in. Origin restriction and Quotas bound abuse. |
| A flood from one Project or from abuse | Quotas isolate Projects. Refusal is cheap and happens before processing. |
| Secrets and personal data in events | Scrubbing runs before any person or store sees an event. Raw retention is bounded and readable only by reprocessing. |
| A leaked Report Reference | A reference is seen by anyone who reads the reporter's email or the linked GitHub issue. Possession is not authorization: the Follow-up Page also requires the reporter's or a Member's sign-in. References cannot be guessed and can be revoked. |
| A forged sign-in | Identity is taken only from a verified assertion by an issuer the Organization trusts. Only an Organization owner names trusted issuers. Anything else identifies nobody. |
| A trusted issuer asserting another person's address | Not prevented: a trusted issuer is trusted for every address it asserts, including a Member's, so it can act as that person. Only the owner's choice of issuers bounds this. See Q6. |
| An Operator reading reporter data | Being an Operator grants no read of a Report, Thread, Attachment or reporter address. Reprocessing never shows a raw arrival to the Operator. |
| Reporter addresses reaching a public GitHub repository | Reporter addresses and Attachments never leave Nightwatch. GitHub receives a link that anyone who can read the repository can see; it opens only for the reporter or a Member of the Project. |
| A screenshot showing private data | Report Attachments are visible to Members of the Project only. |
| Forged GitHub webhooks | A webhook is applied only after it is proven to come from GitHub. |
| A GitHub commenter speaking to a reporter as Nightwatch | A GitHub comment's mark for the reporter is honored only when its author maps to a Member. |
| Forged reply-by-email | A reply is posted only when its sender is authenticated as a known Member address. A claimed sender alone is not authentication; a reply whose sender cannot be authenticated is dropped. |
| A webhook aimed at an internal or another tenant's target | A webhook never reaches the deployment's own endpoints, its internal network, or another Organization's resources. |
| Cross-tenant leakage | Every query, notification and link is scoped to one Organization. Tests prove it for search, Follow-up Pages and notifications. |
| Spam Reports used to harass a team | Report Quota, the Spam Judge, and silent archiving. |
| Spam Judge hides a real Report | Its verdict is visible to Members and can be overturned. |
| Stolen Access Token | Tokens are scoped to one Organization, revocable, and expire when set to. |
| Source maps disclosing source code | Artifacts are readable by Members of the Project only. |

---

## Ships where

Nightwatch ships as open source: tagged releases of this repository. It
runs on any Cloudflare account that adopts it; no hosted deployment is
assumed. Browsers receive the report form, the Follow-up Page and the
triage console.

---

## Key Decisions

| Id | Decision | Choice | Rationale | Origin |
|---|---|---|---|---|
| D1 | Build or adopt | Build | No product closes the loop with a reporter who lacks GitHub access, and none runs on Cloudflare. | Owner, 2026-11-07 session, [concept](../concepts/nightwatch/CONCEPT.md) |
| D2 | Hosting | Cloudflare only, K2 included | Owner direction for all products. | Owner, 2026-11-07 |
| D3 | Relation to Sentry | Clean-room rewrite from studied mechanics; an homage, our own code base | Forking needs Kafka and ClickHouse; a rewrite owns its shape. | Owner, 2026-11-07 |
| D4 | SDK protocol | Accept the Sentry SDK protocol | Instrumentation is solved, and products can move without code changes. | Owner, 2026-11-07 |
| D5 | Report is not an event | Separate entity attached to an Issue | A Report has a person, a reference and a conversation; an event has none. | Drafting, from G9 |
| D6 | Report Status is derived | From the attached Issue alone | Team members triage once; reporters follow without extra work. | Drafting |
| D7 | GitHub sync | Two-way for state and shared comments | Closing on GitHub must reach the reporter. | Owner, 2026-11-07 ("cuts an issue, gives the user something to follow up on") |
| D8 | Grouping parity | Own versioned grouping, honoring SDK fingerprints | Parity would copy expression; SDK fingerprints keep user intent. | Drafting |
| D9 | Deferred products | Tracing, replay, profiling, native symbolication | The core loop ships first; each is large. | Owner, 2026-11-07 ("deferred list sounds good") |
| D10 | Platform limits | Free-plan allocations are soft limits; beta account caps are accepted | Keeps cost near zero; an overrun is a signal to review, not an outage. | Owner, 2026-11-07 |
| D11 | Reporter identity | Every reporter is signed in; the sign-in asserts their email | All users carry an Access token naming their email; anonymous Reports, human checks and contact forms are not needed. | Owner, 2026-11-07 |
| D12 | Project form | Open source, no hosting guaranteed, developed and tested locally | Anyone can run it; contributors need no account; the hosted stage is an adopter's choice. | Owner, 2026-11-07 |
| D13 | Who may share a GitHub comment with a reporter (Q3) | Only commenters mapped to a Member of the Organization | A collaborator who is not a Member is not accountable to the reporter. | Implementation, task-011 |
| D14 | Assignment | A Member action through `assignIssue`; it marks the Issue reviewed and makes the assignee a follower | The design has no Behaviors row for assignment; recorded so it can get one. | Implementation, task-030; drift task-050 |
| D15 | Moving a Report to another Issue | `moveReport`; the reporter hears the new Issue's next change | Design Reports > Duplicates allows the move; no row covers its notice. | Implementation, task-027 |

---

## Open Questions

- **Q1 -- Does one deployment serve unrelated Organizations?** Open source
  lets each adopter run their own. If one deployment also hosts strangers,
  tenancy, quotas and support become product features, not safeguards.
- **Q2 -- Should a reporter be able to reopen a Report?** Today a reporter
  can reply, and a Member decides.
- **Q3 -- Which mapped Members' GitHub marks are honored?** Only a mapped
  Member's mark reaches the reporter. Open is whether any Member of the
  Organization qualifies, or only Members of the Project's Teams.
- **Q4 -- What does a reporter see when two Reports are merged and one
  reporter's words are private?** Today each Thread stays separate.
- **Q5 -- Should Cloudflare Issues feed Nightwatch?** It already groups
  Workers' errors; importing its occurrences would avoid
  double-instrumenting Workers.
- **Q6 -- Should identity bind to issuer plus subject, not email alone?**
  Today a trusted issuer is trusted for every address it asserts, so a
  reassigned address inherits the Reports filed under it.

---

## Rejections

| Alternative | Reason |
|---|---|
| Adopt PostHog | No reporter loop, and its self-hosted stack needs ClickHouse and Kafka. |
| Adopt Sentry SaaS | Hosted outside Cloudflare. |
| Fork Sentry onto K2 | Its Django, Celery, Snuba and ClickHouse core cannot run on Workers; the fork is a multi-quarter port. |
| Domain with a Sentry adapter behind it | Replaced by the rewrite; it would still need a non-Cloudflare host. |
| A Report as an Issue with a random fingerprint and nothing else | It gives the reporter no reference, no status and no replies. |
| Code a bug-report form only, without error tracking | The owner wants the whole feature set; reports without crash context are weaker evidence. |
| Reporters use GitHub | Reporters do not have and should not need GitHub access. |
| Post Reports straight to GitHub issues | Leaks contact details and screenshots to repositories that may be public. |

---

## Future Considerations

- **Tracing and performance** -- its own record, when a product needs
  latency evidence.
- **Session replay** -- its own record; Reports would gain a recording.
- **Native crashes** -- its own record; needs a symbolication runtime.
- **Similar-issue suggestions** -- once enough issues exist to judge
  against.
- **More trackers and channels** -- Jira, Slack, PagerDuty, when asked
  for.
- **Pull request comments listing the issues a change touches** -- after
  suspect commits are trusted.

---

## Related Documents

- [Concept: Nightwatch](../concepts/nightwatch/CONCEPT.md) -- origin; not
  authority.
- [ARCHITECTURE.NIGHTWATCH.md](ARCHITECTURE.NIGHTWATCH.md) -- how this
  record is delivered.
- [LICENSE.md](../../LICENSE.md) -- what was studied, and the clean-room
  terms.