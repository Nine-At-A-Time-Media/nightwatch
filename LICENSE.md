# License and Acknowledgements

## Nightwatch license

Nightwatch is licensed under the Apache License, Version 2.0. The full
text is in [LICENSE](LICENSE).

Copyright 2026 Nine-At-A-Time Media.

## Acknowledgements

Nightwatch is a clean-room reimplementation of an error-tracking and
user-feedback feature set. Before writing its design records, we studied
the software listed below to learn its mechanics: protocols, lifecycle
rules, and behavior.

This repository contains none of that software. It contains no source
code, comments, documentation prose, user-interface text, schemas, or test
data from it, in original or modified form. The design records describe
mechanics in our own words. Where a record cites a file path from these
projects, the path identifies where a mechanic was observed; it does not
reproduce the file.

| Project | Version (tag, commit) | Released | License as studied | Copyright |
|---|---|---|---|---|
| [getsentry/sentry](https://github.com/getsentry/sentry) | `24.10.0`, `2a3cd0e9b6340a0ca4b258f7f21fdbf7a674e1bf` | 2024-10-15 | FSL-1.1-Apache-2.0; Apache License 2.0 from 2026-10-15 | 2008-2024 Functional Software, Inc. dba Sentry |
| [getsentry/relay](https://github.com/getsentry/relay) | `24.10.0`, `2176efefd6f76fffa93e470d51c6918ff494bf23` | 2024-10-15 | FSL-1.1-Apache-2.0; Apache License 2.0 from 2026-10-15 | 2018-2024 Functional Software, Inc. dba Sentry |
| [getsentry/self-hosted](https://github.com/getsentry/self-hosted) | `24.10.0`, `a29a7969f5f7a93e27c67f0aa622452b5ddc2687` | 2024-10-17 | FSL-1.1-Apache-2.0; Apache License 2.0 from 2026-10-17 | 2016-2024 Functional Software, Inc. dba Sentry |
| [getsentry/sentry-javascript](https://github.com/getsentry/sentry-javascript) | `8.34.0`, `d7749aeee11bc54dbba7f801b48655ebf48ad5e1` | 2024-10-10 | MIT | 2012-2024 Functional Software, Inc. dba Sentry |

Each FSL-1.1-Apache-2.0 release above grants an irrevocable Apache License
2.0 on the second anniversary of its release. Each such date had passed
when we studied it (2026-11-07).

## Wire compatibility

Nightwatch accepts data from unmodified Sentry SDKs. It implements the
ingest protocol (DSN, envelope, rate-limit headers) from that protocol's
observable behavior. Protocol compatibility is the only reason Sentry
names appear in Nightwatch code or documentation.

## Trademarks

"Sentry" is a trademark of Functional Software, Inc. Nightwatch is not
affiliated with, endorsed by, or sponsored by Functional Software, Inc.
Nightwatch does not use the Sentry name or marks to identify itself.
