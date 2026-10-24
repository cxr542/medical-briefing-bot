# RSS future publication guard

## Scope and evidence boundary

The 2026-10-12 collection stored six Doctorsnews and five Docdocdoc articles
with publication times later than their creation times. Original RSS `pubDate`
values were not captured. The synthetic fixture reproduces the observed DB UTC
times using manufactured GMT inputs; it is not publisher evidence.

Normal `published_parsed` -> UTC conversion remains unchanged. No source-specific
timezone override or blanket nine-hour correction is applied.

## Policy

`RSS_FUTURE_TOLERANCE` is five minutes, inclusive. It accommodates small publisher
and collector clock differences without accepting hours of timezone drift.
Each parser call uses one UTC `now` for comparison and fallback. Parsed times
at or before `now + tolerance` retain their original instant. Times strictly
after that boundary use `now` as collection-time fallback, matching the existing
missing-date fallback convention. The substituted value is not a claim about
the article's true publication time.

Every substitution emits a warning containing source, sanitized article URL,
parsed publication time, collector now, future delta in seconds, tolerance and
policy. URL credentials, fragments and non-ID query parameters are omitted;
numeric article ID parameters remain for diagnosis. Titles and RSS bodies are
not logged. `future_entries` counts substitutions before the existing press
filter. The seven-day recent condition and press filter remain in place.

## Lifecycle safety and limitations

Fallback keeps otherwise eligible article URLs in the collection snapshot.
Dropping just a future-dated item while reconciling the rest of the source could
incorrectly mark an existing healthy article DELETED. Excluding an entire source
from reconciliation would suppress genuine deletions. Fallback avoids both
changes to identity reconciliation.

The existing title/URL hash and change detection are preserved:

- An unchanged existing article is not upserted merely because fallback now
  differs from its valid stored publication time.
- A new article uses fallback now. An existing article updated for an existing
  lifecycle reason also uses fallback now, consistent with current update rules.
- A genuinely absent URL still follows the existing deletion policy.
- Previously stored bad dates are not repaired by this change. Existing date-only
  differences still do not trigger UPDATE.

Date-only reconciliation is tracked in
[issue #77](https://github.com/cxr542/medical-briefing-bot/issues/77). It needs a
policy that distinguishes authoritative corrections from fallback timestamps
before automatically updating valid stored dates.

## Verification and natural collection observation

Offline tests cover explicit offsets, KST midnight, inclusive tolerance,
over-tolerance fallback and log redaction, seven-day/press behavior, all eleven
synthetic time patterns, and real lifecycle/storage functions with mocked HTTP.
Tests never import or execute the Collector entrypoint.

After review and an independently authorized merge, observe the next naturally
scheduled collection without manual dispatch/rerun. Check fallback warnings,
source health and DB failures. Use read-only queries for rows created during the
run: publication times should not exceed that parser call's `now` by more than
five minutes. Correlate warnings by source/article ID, verify no spurious DELETED
rows, and confirm normal offset inputs remain correct. An absence of warnings
does not establish the historical root cause. Do not alter the existing eleven
rows as part of this verification.
