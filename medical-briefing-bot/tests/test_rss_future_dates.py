"""Offline RSS -> parser -> lifecycle -> mocked PostgREST regression coverage."""
import io
import json
import unittest
from contextlib import redirect_stdout
from datetime import datetime, timedelta, timezone
from email.utils import format_datetime
from pathlib import Path
from unittest.mock import patch
from xml.sax.saxutils import escape

import feedparser
from collector_lifecycle import find_absent_article_urls
from collector_parsers import KST, RSS_FUTURE_TOLERANCE, parse_rss_entries
from collector_sources.medical_press import is_valid_press_article
from test_source_detail_urls import RestStore, load_functions

NOW = datetime(2026, 10, 12, 8, 8, 5, tzinfo=timezone.utc)
URL = "https://example.test/news/articleView.html?idxno=1"
FIXTURE = Path(__file__).parent / "fixtures/rss-future-patterns-synthetic.json"


def rss_entry(pub_date, *, url=URL, title="Synthetic medical article"):
    xml = (
        '<rss version="2.0"><channel><title>Synthetic</title>'
        '<link>https://example.test</link><description>Offline test</description>'
        f'<item><title>{escape(title)}</title><link>{escape(url)}</link>'
        f'<pubDate>{escape(pub_date)}</pubDate></item></channel></rss>'
    )
    return feedparser.parse(xml).entries[0]


class RssFutureDateTests(unittest.TestCase):
    def parse(self, entries, *, now=NOW, source="청년의사", **kwargs):
        return parse_rss_entries(entries, "https://example.test/rss", source,
                                 now=now, **kwargs)

    def future_entry(self, delta=timedelta(hours=8), **kwargs):
        return rss_entry(format_datetime(NOW + delta, usegmt=True), **kwargs)

    def test_positive_offset_is_normalized_to_utc_without_correction(self):
        entry = rss_entry("Mon, 12 Oct 2026 16:18:55 +0900")
        self.assertEqual(entry.published_parsed[:6], (2026, 10, 12, 7, 18, 55))
        result = self.parse([entry])
        self.assertEqual(result["articles"][0]["published_date"],
                         "2026-10-12T07:18:55+00:00")
        self.assertEqual(result["future_entries"], 0)

    def test_gmt_and_zero_offset_are_normalized_to_utc(self):
        for offset in ("GMT", "+0000"):
            with self.subTest(offset=offset):
                entry = rss_entry(f"Mon, 12 Oct 2026 07:18:55 {offset}")
                self.assertEqual(entry.published_parsed[:6], (2026, 10, 12, 7, 18, 55))
                self.assertEqual(self.parse([entry])["articles"][0]["published_date"],
                                 "2026-10-12T07:18:55+00:00")

    def test_kst_midnight_keeps_the_same_instant(self):
        entry = rss_entry("Tue, 13 Oct 2026 00:01:00 +0900")
        now = datetime(2026, 10, 12, 15, 2, tzinfo=timezone.utc)
        result = self.parse([entry], now=now)
        instant = datetime.fromisoformat(result["articles"][0]["published_date"])
        self.assertEqual(instant.isoformat(), "2026-10-12T15:01:00+00:00")
        self.assertEqual(instant.astimezone(KST).isoformat(), "2026-10-13T00:01:00+09:00")

    def test_tolerance_just_before_and_exact_boundary_are_allowed(self):
        for delta in (RSS_FUTURE_TOLERANCE - timedelta(seconds=1), RSS_FUTURE_TOLERANCE):
            with self.subTest(delta=delta), patch("collector_parsers.logger.warning") as warning:
                result = self.parse([self.future_entry(delta)])
                warning.assert_not_called()
                self.assertEqual(result["future_entries"], 0)
                self.assertEqual(result["articles"][0]["published_date"], (NOW + delta).isoformat())

    def test_tolerance_exceeded_falls_back_and_logs_required_context(self):
        delta = RSS_FUTURE_TOLERANCE + timedelta(seconds=1)
        with self.assertLogs("collector_parsers", level="WARNING") as logs:
            result = self.parse([self.future_entry(delta)])
        self.assertEqual(result["future_entries"], 1)
        self.assertEqual(result["articles"][0]["published_date"], NOW.isoformat())
        context = json.loads(logs.records[0].getMessage().split(": ", 1)[1])
        self.assertEqual(context, dict(
            source="청년의사", article_url=URL,
            parsed_published_time=(NOW + delta).isoformat(), collector_now=NOW.isoformat(),
            future_delta_seconds=301.0, tolerance_seconds=300.0, policy="now_fallback"))

    def test_diagnostic_omits_credentials_private_query_fragment_and_title(self):
        url = ("https://user:password@example.test/news?idxno=19566"
               "&token=secret-token&email=private-person#private-fragment")
        with self.assertLogs("collector_parsers", level="WARNING") as logs:
            result = self.parse([self.future_entry(url=url, title="private-title")])
        text = "\n".join(logs.output)
        for private in ("user", "password", "secret-token", "private-person", "private-fragment", "private-title"):
            self.assertNotIn(private, text)
        self.assertIn("https://example.test/news?idxno=19566", text)
        self.assertEqual(result["articles"][0]["url"], url)

    def test_now_is_normalized_from_kst_or_naive_utc(self):
        for now in (NOW.astimezone(KST), NOW.replace(tzinfo=None)):
            with self.subTest(now=now), self.assertLogs("collector_parsers", level="WARNING"):
                self.assertEqual(self.parse([self.future_entry()], now=now)["articles"][0]["published_date"],
                                 NOW.isoformat())

    def test_seven_day_boundary_preserves_existing_inclusion(self):
        cutoff = NOW - timedelta(days=7)
        entries = [rss_entry(format_datetime(cutoff, usegmt=True), url=URL + "0"),
                   rss_entry(format_datetime(cutoff - timedelta(seconds=1), usegmt=True), url=URL + "1")]
        result = self.parse(entries)
        self.assertEqual(result["recent_entries"], 1)
        self.assertEqual([a["url"] for a in result["articles"]], [URL + "0"])

    def test_press_filter_still_applies_to_future_entries(self):
        entries = [self.future_entry(title="새로운 의료계 임상 연구 결과"),
                   self.future_entry(title="병원장 인사 발령 안내", url=URL + "2")]
        with self.assertLogs("collector_parsers", level="WARNING"):
            result = self.parse(entries, is_press=True, press_filter=is_valid_press_article)
        self.assertEqual((result["future_entries"], result["recent_entries"], result["filtered_entries"]), (2, 2, 1))
        self.assertEqual([a["url"] for a in result["articles"]], [URL])

    def test_missing_date_keeps_existing_now_fallback(self):
        result = self.parse([{"title": "No date", "link": URL}])
        self.assertEqual(result["articles"][0]["published_date"], NOW.isoformat())
        self.assertEqual(result["future_entries"], 0)

    def test_all_eleven_synthetic_patterns_fall_back_without_losing_identity(self):
        fixture = json.loads(FIXTURE.read_text())
        self.assertIn("not captured RSS", fixture["description"])
        self.assertEqual(len(fixture["records"]), 11)
        for record in fixture["records"]:
            with self.subTest(id=record["id"]):
                instant = datetime.fromisoformat(record["published_utc"])
                url = f'https://example.test/news?idxno={record["id"]}'
                entry = rss_entry(format_datetime(instant, usegmt=True), url=url)
                self.assertEqual(datetime(*entry.published_parsed[:6], tzinfo=timezone.utc), instant)
                self.assertEqual(instant.astimezone(KST).date().isoformat(), "2026-10-13")
                with self.assertLogs("collector_parsers", level="WARNING"):
                    result = self.parse([entry], source=record["source"],
                                        now=datetime.fromisoformat(fixture["collector_now"]))
                self.assertEqual(result["articles"][0]["published_date"], fixture["collector_now"])
                self.assertEqual(result["articles"][0]["url"], url)

    def sync(self, rows, articles):
        store = RestStore(rows)
        self.addCleanup(store.client.aclose)
        with redirect_stdout(io.StringIO()):
            result = load_functions(store.client)["sync_articles"](articles)
        return store, result

    def guarded_article(self):
        with self.assertLogs("collector_parsers", level="WARNING"):
            return self.parse([self.future_entry()])["articles"][0]

    def test_existing_normal_article_is_neither_deleted_nor_date_overwritten(self):
        guarded = self.guarded_article()
        old = dict(guarded, id=42, published_date=(NOW - timedelta(hours=1)).isoformat())
        absent = find_absent_article_urls([old], [guarded], set())
        self.assertEqual(absent, set())
        store, result = self.sync([old], [guarded])
        self.assertEqual(result["attempted"], 0)
        self.assertEqual(store.rows, [old])
        self.assertEqual([r[0] for r in store.requests], ["GET"])

    def test_new_future_article_saves_now_to_mock_database(self):
        guarded = self.guarded_article()
        store, result = self.sync([], [guarded])
        self.assertEqual(result, dict(attempted=1, succeeded=1, failed=0))
        self.assertEqual(store.rows[0]["published_date"], NOW.isoformat())
        self.assertEqual(store.rows[0]["status"], "NEW")

    def test_changed_article_saves_fallback_without_becoming_deleted(self):
        guarded = self.guarded_article()
        old = dict(guarded, id=42, content_hash="previous-title-hash",
                   published_date=(NOW - timedelta(hours=1)).isoformat())
        store, result = self.sync([old], [guarded])
        self.assertEqual(result["succeeded"], 1)
        self.assertEqual(store.rows[0]["status"], "UPDATE")
        self.assertEqual(store.rows[0]["published_date"], NOW.isoformat())

    def test_genuinely_absent_article_is_still_deleted(self):
        guarded = self.guarded_article()
        old = dict(guarded, id=42, url=URL + "2", published_date=(NOW - timedelta(hours=1)).isoformat())
        store, result = self.sync([old], [guarded])
        self.assertEqual(result["succeeded"], 2)
        absent = next(a for a in store.rows if a["url"] == old["url"])
        self.assertEqual(absent["status"], "DELETED")
        self.assertEqual(absent["published_date"], old["published_date"])


if __name__ == "__main__":
    unittest.main()
