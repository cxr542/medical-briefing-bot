# Optional Kiwi title boundary guard

The Collector saves baseline article rows first. For naturally saved NEW/UPDATE
rows with confirmed empty stored keywords, one lazy child produces title-token
boundary metadata. Stored keywords and the existing frontend scores, cap of four,
and title-evidence compound rules remain authoritative. LAW and DailyMedi records
are excluded from this optional path.

Apply the new nullable `articles.keyword_boundary` migration separately before
enabling writes in a deployment. This PR does not apply any Production migration.
If the column or optional package is unavailable, baseline collection/display
continues. Metadata writes update only that column and require matching URL/title.
Old or malformed metadata is ignored by the frontend.

The parent does not import Kiwi. One long-lived child initializes the pinned CoNg
model once. Its stdin/stdout protocol is bounded JSON lines; no shell or article
payload arguments are used. Startup has a 10-second ready deadline, requests a
5-second IO deadline. Graceful exit, TERM and KILL each have a bounded wait.

A failed request falls back immediately. At most one replacement is started on
the next eligible request, after the old child exits; requests are not replayed.
The second failure disables Kiwi for the run. Import/init failure, MemoryError or
an observed external SIGKILL disable immediately. Analysis errors may reuse a
healthy child once. Host-wide OOM is not isolated by this process boundary.

Fast tests reuse the frozen 38-token morphology/gold fixture and simulated child
responses/deaths. A path-scoped PR job runs the actual pinned native child and
reports its Linux RSS without invoking the Collector or creating memory pressure.
Those observations do not establish whole-Collector/Chromium peak usage.

Rollback the producer/consumer code and optional dependency install to return to
baseline. The nullable column may remain unused; no backfill or column drop is
required. This guard does not solve importance ranking or the care/welfare terms
missing from an AI article's top display.
