# Stories: capture

Roles: **developer** (instruments a product), **reporter**, **operator**
(runs Nightwatch).

- As a developer, I can point an existing Sentry SDK at Nightwatch and
  change nothing else.
- As a developer, I can capture uncaught errors from browsers, Node,
  Workers and Python services.
- As a developer, I can see the stack trace of a minified browser error as
  the code I wrote, not the code that shipped.
- As a developer, I can see what happened just before an error: the
  breadcrumbs, the request, the release, the environment and the user.
- As a developer, I can attach files to an event, and they stay with it.
- As a developer, I can tell Nightwatch how to group my errors when the
  default gets it wrong.
- As a developer, I can see a whole request across services when an error
  happens in the middle of it. (Aspiration: tracing.)
- As a developer, I can watch what the user did in the moments before a
  crash or a report. (Aspiration: session replay.)
- As a developer, I can see which code was slow, not only which code
  failed. (Aspiration: performance and profiling.)
- As a developer, I can capture crashes from native code and see them
  symbolicated. (Aspiration.)
- As a developer, I can report the health of each release: how many
  sessions ended in a crash.
- As a developer, I can tell Nightwatch that a scheduled job ran, and be
  told when it did not.
- As a developer, I can have Nightwatch check that a URL is up.
- As a reporter, I am never asked whether my data may be sent; the product
  has already decided what is safe to send, and secrets are removed before
  anyone sees them.
- As an operator, I can turn away a flood from one product without the
  others losing data.
- As an operator, I can drop known noise -- browser extensions, crawlers,
  localhost -- before it costs anything.
