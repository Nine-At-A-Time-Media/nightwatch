# @nightwatch/widget

The embeddable report form: a Vue custom element, `<nightwatch-report>`,
that a product puts on its own pages. It asks a signed-in reporter for a
message (the only required input) and an optional screenshot, files the
Report Submission through the product's same-origin tunnel route, and shows
the Filing Receipt: the Report Reference and a link to its Follow-up Page.
It never asks for a name or an address; the reporter's identity comes from
the product's Access session, which travels with the same-origin request.

Design and architecture records live at the repository root:
`docs/design/DESIGN.NIGHTWATCH.md` (Reports) and
`docs/design/ARCHITECTURE.NIGHTWATCH.md` (Mechanism: Sign-in, Reports).

## Embedding

```html
<script type="module" src="/assets/nightwatch-report.js"></script>
<nightwatch-report
  endpoint="/nightwatch/report"
  project="PROJECT_ID"
  associated-event="EVENT_ID"
  max-message-length="4000"
></nightwatch-report>
```

| Attribute | Required | Meaning |
|---|---|---|
| `endpoint` | yes | The product's same-origin tunnel route that forwards to Nightwatch. |
| `project` | yes | The Project id the Report is filed under. |
| `associated-event` | no | An Event id the Report is about. |
| `max-message-length` | no | The message bound the form checks before sending. Absent means no bound in the form; the server always enforces its own. |

## HTTP contract

The form sends one request per submit (and one per Retry):

- `POST {endpoint}`, `credentials: 'same-origin'`, `Accept: application/json`.
- Body `multipart/form-data` with fields:
  - `project` -- the Project id.
  - `message` -- the reporter's message.
  - `screenshot` -- optional file, `image/png` or `image/jpeg`.
  - `associatedEventId` -- optional Event id.

Answers the form understands:

| Status | Body | The form shows |
|---|---|---|
| 201 (any 2xx) | `{"reference", "status", "followUpUrl"}` | "Report sent", the reference, and a link to `followUpUrl`. |
| 2xx, body not a receipt | anything else | "Your report may have been sent, but no reference came back." |
| 400 | `{"refusal": "<reason>"}` | The reason in plain words (`empty-message`, `message-too-long`, `invalid-screenshot`); an unknown reason reads "Your report was not accepted." |
| 401, 403 | any | "You are not signed in." |
| 429 | any | "Too many reports right now, try again later." |
| 5xx, or the request never completes | any | "Your report was not sent." with Retry; the typed message is kept. |
| any other 4xx | `{"refusal"}` if present | As for 400. |

`followUpUrl` must be an `http(s)://` URL or a same-origin path starting
with `/`; anything else is treated as an unreadable receipt, so the form
never renders a script link.

## Layout

| Path | Layer | Holds |
|---|---|---|
| `src/domain/` | domain | The Report Form state machine (idle, editing, sending, sent, failed), message and screenshot rules, the wording of each Refusal. Pure. |
| `src/ports/` | ports | `ReportSender`. |
| `src/adapters/` | adapters | `ReportForm.ce.vue` (the component) and `FetchReportSender` (the HTTP client). |
| `src/main.ts` | composition root | Registers `<nightwatch-report>` and provides the `FetchReportSender`. |

## Commands

```bash
pnpm --filter @nightwatch/widget build
pnpm --filter @nightwatch/widget test
pnpm --filter @nightwatch/widget typecheck
```

`build` writes one ES module, `dist/nightwatch-report.js`, with Vue bundled
in. The widget's tests also run from the root `pnpm test` (project
`widget`).
