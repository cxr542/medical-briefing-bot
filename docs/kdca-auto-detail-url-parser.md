# KDCA optional detail extraction

Final baseline main: `e096edf31a53c0d90687aa0476d6fffc7f5b8411`, including #70/#71/#72/#73/#74/#76.
Initial inspection used 93d42d2; main advanced with the independent #74 KST badge
change during this task. Branch was rebased and frontend/build checks rerun. The
frozen 93d42d2 parser baseline is identical to the final main parser.
Final #75 synchronization rebased onto #76 without conflicts. ArticleList is
identical to main; search pagination reset is preserved. Three supplemental
offline tests exercise its actual search/next/previous handlers (AST extraction
in a workspace scratch harness, not a frontend code change or remote CI suite).
Branch: `feat/kdca-auto-detail-url-parser`. Open baseline PRs #54/#55/#38 remain
untouched; their LAW/release hunks do not overlap this parser implementation.

**NO BACKFILL — NO MANUAL COLLECTOR RUN — NO PRODUCTION DB WRITE — NO MIGRATION.**
No workflow dispatch, scheduler change, environment change, deployment or merge
was performed by this task. Production schema was inspected with SELECT only:
source_detail_url is text, nullable, no default; url remains NOT NULL. The earlier
migration-time count of 4,384 rows is historical and was not reused as current.

## Evidence and root cause

PR #71's checked-in investigation documented the actual official title anchor:
`href="javascript:jf_viewArtcl('kdca', '42', '312868')"`, board 42, and the resulting
canonical detail URLs for 312868/312844/312845. Its investigation verified
same-title/detail correspondence at that time; it is not new live evidence.

Current Cloud READ-ONLY KDCA GET failed at the network proxy (403 tunnel denial):
**NETWORK_UNVERIFIED**. No claim is made that current live markup was fetched.
The added HTML fixture is explicitly a reconstructed offline representation of
those documented call/title pairs, with fixed test dates, not a captured page.
Double-quoted literal, whitespace, optional semicolon and onclick variants are
safe narrow grammar variants tested offline, not claimed live observations.

The existing parser recognizes direct paths and loose artclSeq/artclNo/articleNo
patterns, then quoted numbers in onclick; it does not recognize the documented
three-argument href call. For that href it builds the title-search identity.
Those existing identity heuristics are intentionally unchanged. In particular,
onclick previously producing a direct identity continues to do so. This PR does
not convert any prior identity from search to detail or detail to search.

## Strategy and validation

BeautifulSoup selects the existing row/title anchor. Only that anchor's href and
onclick can provide metadata; page-wide search and neighbor/ancestor ID borrowing
are forbidden. The anchor's closest tr must be the selected row; its normalized
text must equal the already computed article title. Another call-bearing anchor
in the same row makes association ambiguous. Metadata is suppressed for repeated
titles or repeated detail IDs across returned articles; article counts/identity
are not deduplicated or altered.

Grammar: optional surrounding ASCII whitespace, exact `javascript:` prefix for
href, exact `jf_viewArtcl`, parentheses, exactly three comma-separated quoted
literal arguments, optional final semicolon, and nothing else. Quoted arguments
must be kdca, 42 and a positive ASCII ID of 1–18 digits, without leading zero.
Escapes, expressions, comments, extra arguments/statements, wrong institution or
board, malformed quotes, negative/decimal/unicode/path/query/fragment IDs fail.
No eval or JavaScript execution. href/onclick calls must agree; unrelated onclick
or external/direct href does not yield new optional metadata. Existing direct
href display is already supported and does not need this extraction.

The caller must supply the exact established official list URL. A validated ID
builds `https://www.kdca.go.kr/bbs/kdca/42/{ID}/artclView.do`, then passes the #73
validated_source_detail_url source/identity/domain/path validator. Only successful
validation adds the optional source_detail_url key.

## Identity, failure and lifecycle

The original article.url/content_hash/status/date/row filtering remain byte-for-
byte on the existing path; metadata is added after baseline article validation.
Bad/missing/ambiguous extraction does not drop the article, change counts, raise
a source failure or clear stored metadata. The frozen baseline parser fixture
proves parity for valid and invalid calls, existing onclick behavior and DOM
association cases. The existing Collector RSS-first/list-fallback orchestration
is unchanged: this extraction runs on the official list fallback. Successful RSS
collection follows its pre-existing path and does not require this metadata.

No new write path exists. Parser candidates flow through #73 primary payload
stripping and conditional metadata writer. New articles still save primarily
through on_conflict=url, then optional metadata fill. Naturally reobserved active
rows with matching source/title/hash/publication and NULL metadata can receive a
metadata-only fill without a primary lifecycle save. Same value no-ops, non-NULL
conflicts are preserved, failed extraction preserves existing metadata, and
DELETED rows remain excluded by #73. No DB scan/backfill loop/script is added.

#73's 28 storage tests and 108 lifecycle vectors are rerun unchanged. Health,
recovery, source health, collector_runs, Admin, #70 NHIS, #71 three mappings,
#72 schedule and #73 frontend priority remain unchanged. No frontend change.

## Offline verification

| Suite | Total | PASS | FAIL | SKIP |
|---|---:|---:|---:|---:|
| Python Collector, including 20 new KDCA parser/integration tests | 191 | 190 | 0 | 1 |
| Frontend | 160 | 160 | 0 | 0 |
| Health Engine | 16 | 16 | 0 | 0 |
| Recovery | 17 | 17 | 0 | 0 |
| Admin security | 9 | 9 | 0 | 0 |
| Admin integration (local fixture) | 7 | 7 | 0 | 0 |
| Release-note guard | 6 | 6 | 0 | 0 |
| Supplemental #76 actual-handler pagination | 3 | 3 | 0 | 0 |
| **Unique tests** | **409** | **408** | **0** | **1** |

The 108 lifecycle vectors are subcases, not additional test counts. SKIP is the
existing optional pinned Kiwi native smoke. TypeScript, ESLint, diff check and
production webpack build pass. Initial Admin integration startup failed because a
prior test-owned Next dev server/lock remained; after stopping that orphan, all
seven integration tests passed on rerun. Build uses command-local fake/offline Supabase
configuration with normal font fetching, not Production values. No Turbopack run
was repeated for this parser-only change; prior Cloud listener EPERM is historical
and is not a current PASS or fresh failure. Remote CI/Preview are separate checks.

Tests load actual Collector fallback/storage functions through AST without
importing or executing collector.py. HTTP/SDK integration stays in MockTransport;
no production Collector or DB write occurs. Physical Safari/iPad were not tested.

## Natural-run validation and rollback

After separate review and authorized merge, observe the first naturally scheduled
slot (08:30,12:07,15:07,17:07 KST) and preferably 2–3 consecutive natural runs.
Do not manually dispatch or rerun. Verify GitHub conclusion, collector_runs result
and primary counts, KDCA source health/count, new optional values, unchanged URL
identity, no duplicate/unexpected deletion and frontend official links. Distinguish
SUCCESS from unrelated-source DEGRADED: workflow success is not proof every source
is healthy. If the live layout does not match the narrow grammar, metadata should
remain absent with the old UI fallback; obtain live evidence before expanding it.

Rollback this parser PR/application code if needed, retaining #73 infrastructure,
nullable column and existing metadata. Do not clear metadata, change article.url
or backfill on rollback. Legacy #71 mappings remain. Any historical backfill or
correction is a separately approved operation.
