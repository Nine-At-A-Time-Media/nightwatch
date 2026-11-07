# Nightwatch

> **Phase:** 1 -- CONCEPT. Unfunded, non-binding, not a design record.
> **Date:** 2026-11-07  **Author:** Nine-At-A-Time Media (captured with AI assistance)

## The idea

We need to take bug reports from the people who use what we build -- the
cadre of players in front of misvtt first, and whoever is in front of the
next product after that. Those people do not have GitHub access, and they
should never need it. They need a "report a bug" button. Pressing it must
do two things: cut an issue where the developers work, and hand the
reporter something they can follow up on.

Today's error-tracking products get half of this. They capture crashes and
telemetry well, and some of them have a feedback widget. But once the
reporter presses submit, the reporter is done: they get a thank-you that
disappears, and nothing comes back. Nobody tells them the bug was fixed,
asked them a question, or closed it. We want the loop closed.

We also want the whole crash-analytics feature set, not just the button:
capture of errors from browsers and servers, grouping of repeat crashes
into one issue, triage, alerts, release tracking, and a link to the code.
The feature set Sentry built is the reference for what "whole" means. We
studied Sentry 24.10.0 for its mechanics, and we are writing our own from
scratch. Existing Sentry SDKs should be able to send to it unchanged.

It runs on Cloudflare, and only on Cloudflare, built from what Cloudflare
offers today: Workers, Durable Objects, D1, R2, and the new K2 event
streams among them. Self-hosted Sentry and PostHog both need Kafka,
ClickHouse and Postgres, which Cloudflare cannot run. That is the gap this
fills.

## Story sets

| File | Theme |
|---|---|
| [STORIES.reporting.md](STORIES.reporting.md) | The person who hits the bug: reporting it and following it to the end |
| [STORIES.capture.md](STORIES.capture.md) | Getting crashes, feedback and context out of the product without anyone asking |
| [STORIES.triage.md](STORIES.triage.md) | The team turning a stream of crashes and reports into a short list of issues |
| [STORIES.alerting.md](STORIES.alerting.md) | Being told about the right things, at the right time, without noise |
| [STORIES.code.md](STORIES.code.md) | The link between an issue and the code, the commit, and the GitHub issue |
| [STORIES.operating.md](STORIES.operating.md) | Running Nightwatch itself: tenants, access, cost, retention |

## Notes

**Settled in session (2026-11-07):**

- Build, do not adopt. PostHog and Sentry were weighed. Neither closes the
  loop with a reporter who has no GitHub access, and neither runs on
  Cloudflare.
- Cloudflare only, including K2. The owner considered forking Sentry onto
  K2 and dropped that for a rewrite.
- Clean room. Sentry 24.10.0 (Apache 2.0 since 2026-10-15) is studied for
  mechanics. Nothing from Sentry is committed except the acknowledgement
  in `LICENSE.md`.
- An earlier idea in the session was a domain with a Sentry adapter behind
  it. The owner replaced that with the rewrite; the domain-first shape
  survives.
- The repository is `Nine-At-A-Time-Media/nightwatch`, licensed Apache 2.0.

**Still open:**

- How much of the feature set is "whole". The ask was soup to nuts.
  Tracing and performance, session replay, profiling and native crash
  symbolication are the heaviest pieces. Nobody has yet said whether they
  are in.
- Whether reporters are always people the product already knows (as with
  misvtt, behind Cloudflare Access), or sometimes anonymous members of the
  public.
- Whether Nightwatch serves only our products, or other teams too.

**Leans on:**

- K2 is a public beta, launched 2026-10-01, and is not yet Kafka
  compatible.
- Cloudflare launched its own "Issues" (Workers error grouping) on
  2026-09-30. It covers Workers only, with no browser capture and no
  feedback, so it sits beside this idea rather than replacing it.
