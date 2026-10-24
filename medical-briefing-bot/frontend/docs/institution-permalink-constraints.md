# Institution permalink constraints and fallback UX

Current policy, confirmed on 2026-10-13 using the operator's supplied Chrome and
fresh-incognito verification. This document supersedes earlier uncertainty; it
does not rewrite the historical investigations or claim an agent live-browser
verification. Site changes may require future revalidation.

| Source | Stable ID | Browser behavior | External permalink | Policy |
|---|---|---|---|---|
| 심평원 e-평가 (평가알림방) | brdSno | Different articles share index.jsp; fresh session → initial screen | Unavailable | Institution fallback |
| 심평원 업무포탈 (자보알림방) | nttId | Shared BoardDetail popup URL lacks ID; fresh session → empty detail | Unavailable | Institution fallback |
| 산재업무포탈 | ser | Article opens normally inside portal; fresh session with copied URL → main screen | Unavailable | Institution fallback |
| 보건의료자원포탈 | no/qnaNo | Shared index.jsp?sso=ok lacks ID; fresh session → initial screen | Unavailable | Institution fallback |

All four: **TYPE C — INTERNAL STATE NAVIGATION**, **CONSTRAINT CONFIRMED**,
**FALLBACK BY DESIGN**. They are not unresolved direct-link bugs.

Evidence supplied by the operator:

- e-평가: `https://aq.hira.or.kr/hira_aq/index.jsp` stayed unchanged between
  article views; opening it in a fresh incognito session reset to the initial page.
- 자보: `https://biz.hira.or.kr/popup.ndo?formname=qya_bizcom%3A%3ABoardDetail.xfdl&framename=BoardDetail`
  contained no nttId; the same URL in incognito displayed an empty detail window.
- COMWEL: “청력검사 전문 의료기관 추가인증 결과 알림”, ser=2145,
  published 2026-09-28, opened normally in the portal. Copying its address into
  incognito restored the main screen. The stored #ser=2145 is not a permalink.
- HURB: “지역사회 일차의료 혁신 시범사업 관련 인력신고 안내”, no=758,
  published 2026-09-22, kept `https://www.hurb.or.kr/hira_sg/index.jsp?sso=ok`
  without no/qnaNo; a fresh incognito session opened the initial screen.

**Stable ID != External Permalink.**
**Collector identity URL != User-facing direct URL.**
An internal POST/detail API or frame state is not a browser permalink. Keep
article.url, duplicate/upsert/deletion identity and content hashes unchanged.
Do not manufacture detail URLs from ser/no/brdSno/nttId or backfill these four
sources. #73 storage and #75 KDCA metadata policies remain intact.

## Fallback interaction

The four sources explain that the institution's site cannot open this notice
through a direct link, then show the exact original title in a selectable,
wrapping panel. “제목 복사” uses Clipboard.writeText and leaves the dialog open.
A polite live status announces success; missing/rejected clipboard instead
explains how to select/copy the title manually. No deprecated execCommand,
permission prompt flow, title transformation or silent success is used.

“기관 페이지 열기” retains the existing institution URL, opens a new tab, and
keeps noopener noreferrer. Source-specific existing list guidance remains; a
search box is not promised. The native dialog keeps its labelled description,
initial close-button focus, native Escape, close/backdrop actions and focus return.
The copy control is type=button and never closes the modal.

Other institution fallbacks, such as unverified KDCA/NHIS notices, keep the
“direct link has not been confirmed” distinction; they are not falsely classified
as permalink-free sites. Direct sources/resolver URLs remain unchanged.

## Scope, rollback and verification

No Collector, parser, identity, metadata writer, schema, database, schedule or
production config/deployment change is part of this UX work. Rollback reverts
these guidance/component/documentation changes; no data/schema rollback required.

Tests exercise real component handlers for clipboard success/rejection/missing
API, feedback, close reset and native cancel preservation; server rendering covers
labels/title/new-tab links and existing direct regressions. Browser/device QA is
reported separately, not inferred from unit tests. Before production release,
check actual modal open/focus/Escape, copy outcomes and long-title wrapping at
390px, tablet and desktop. Physical Safari/iPad require separate device testing.

Historical evidence remains in [the 2026-10-09 investigation](source-link-recovery-2026-10-09.md).
