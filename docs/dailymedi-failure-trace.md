# DailyMedi failure trace evidence

This is diagnostic instrumentation, not a TLS repair. The independent runner
experiment [40453602883](https://github.com/cxr542/medical-briefing-bot/actions/runs/40453602883)
returned eight HTTP 200 responses and did not reproduce the intermittent
`SSLZeroReturnError` recorded in Collector run
[40442361891](https://github.com/cxr542/medical-briefing-bot/actions/runs/40442361891).

## Added failure-only fields

| Field | Evidence recorded |
| --- | --- |
| `trace_tls_handshake` | An allowlisted `ssl.do_handshake` frame exists |
| `trace_http_headers` | An allowlisted `http.client` response-header frame exists |
| `trace_http_body` | An allowlisted `http.client` or `urllib3.response` body-read frame exists |
| `trace_truncated` | The exception chain reached 16 entries, or a traceback exceeded 64 frames |

These flags record frame presence across the existing bounded exception chain.
They are not a mutually exclusive phase classification or a root-cause verdict.
Several flags may be true. All false means no known frame was observed, not a
successful handshake. A chain of exactly 16 entries conservatively reports the
limit as reached, even if no additional exception exists. Missing or changed
library function names produce unknown evidence rather than guessed phases.

Only module/function names are compared in memory against constant allowlists.
Output contains booleans, not those names. Frame locals, paths, source lines,
exception strings, request/response data and credentials are not read or emitted
by this helper. At most 16 exception tracebacks of 64 frames each are inspected.
First-attempt successes and retry-recovery success logs receive no new fields.

## Validation and interpretation

Eight new offline tests cover known and unknown frames, absent tracebacks,
wrapped and overlapping evidence, cycles, chain/frame bounds, secret sentinels,
failure/recovery logging and unchanged request options. Real standard-library
handshake/header/body functions are also exercised with fake I/O, without a
network connection. The full local suite on
Python 3.12 ran 229 tests: 228 passed and one optional native keyword-boundary
smoke test was skipped. Existing tests cover three attempts, backoffs, partial
snapshots, identity and deletion protection. Python 3.9 compatibility is checked
by the existing Collector regression CI; no workflow change is required.

After a separately approved merge, inspect the next normally triggered
Collector failure. Correlate the flags with the existing request kind, article
ID/page, SSL errno, attempt and outcome fields. Do not manually run Collector
or assume a green workflow means every source succeeded. Do not change TLS,
retry policy or transport based on the flags alone; a repair still requires
evidence supporting its mechanism and regression coverage.

No network call, collection schedule, stored URL, database schema, duplicate
key, lifecycle or deletion policy changes. Rollback is a revert of this PR;
there is no data backfill or migration. No automatic merge is authorized.
