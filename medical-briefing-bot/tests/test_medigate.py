from datetime import date, datetime, timedelta, timezone
import json
from pathlib import Path
import unittest
from collector_sources.medigate import (
    MedigateSourceError,
    build_date_url,
    collect_recent_articles,
    parse_medigate_page,
)


FIXTURES = Path(__file__).parent / "fixtures"
NOW = datetime(2026, 10, 1, 3, 0, tzinfo=timezone.utc)
KST = timezone(timedelta(hours=9))


def fixture_bytes(name):
    return (FIXTURES / name).read_bytes()


def make_item(news_id, title, published_ms, modified_ms=1790601103000):
    return {
        "id": 57837,
        "news_id": news_id,
        "display_title": title,
        "display_modified_date": published_ms,
        "modified_date": modified_ms,
        "regist_date": None,
    }


def make_page(day, next_date, news_list):
    return json.dumps(
        {"list": [{"date": day, "newsList": news_list}], "nextDate": next_date},
        ensure_ascii=False,
    ).encode("utf-8")


class MedigateParserTests(unittest.TestCase):
    def test_fixture_uses_news_id_and_direct_publisher_url(self):
        page = parse_medigate_page(fixture_bytes("medigate-response.json"))
        article = page.articles[0]

        self.assertEqual(article.news_id, 2302962946)
        self.assertEqual(article.title, "'응급실미수용' 방지법 법사위 통과…야당 지적 나오자 복지부 \"학회도 반대 안해\"")
        self.assertEqual(article.published_at, datetime(2026, 9, 28, 12, 57, 36, tzinfo=timezone.utc))
        self.assertEqual(page.next_date, date(2026, 9, 27))

    def test_modified_date_is_not_used_for_publication_time(self):
        page = parse_medigate_page(fixture_bytes("medigate-response.json"))
        self.assertEqual(page.articles[0].published_at.astimezone(KST).strftime("%y.%m.%d %H:%M"), "26.09.28 21:57")
        self.assertNotEqual(page.articles[0].published_at.astimezone(KST).strftime("%H:%M"), "22:11")

    def test_korean_utf8_body_is_decoded(self):
        page = parse_medigate_page(fixture_bytes("medigate-response.json"))
        self.assertIn("응급실미수용", page.articles[0].title)

    def test_malformed_json_fails_the_source(self):
        with self.assertRaisesRegex(MedigateSourceError, "UTF-8 JSON"):
            parse_medigate_page(b"{invalid json")

    def test_unexpected_root_fails_the_source(self):
        with self.assertRaisesRegex(MedigateSourceError, "response root"):
            parse_medigate_page(b"[]")

    def test_malformed_date_group_fails_the_source(self):
        payload = b'{"list":[{"date":"2026-09-28","newsList":"bad"}],"nextDate":"2026-09-27"}'
        with self.assertRaisesRegex(MedigateSourceError, "newsList"):
            parse_medigate_page(payload)

    def test_empty_news_list_is_valid(self):
        page = parse_medigate_page(make_page("2026-09-28", "2026-09-27", []))
        self.assertEqual(page.articles, ())

    def test_invalid_article_fields_are_skipped(self):
        page = parse_medigate_page(fixture_bytes("medigate-response.json"))
        self.assertEqual(len(page.articles), 1)

    def test_duplicate_news_id_is_kept_once(self):
        page = parse_medigate_page(fixture_bytes("medigate-response.json"))
        self.assertEqual([article.news_id for article in page.articles], [2302962946])
        self.assertTrue(page.articles[0].title.startswith("'응급실미수용'"))

    def test_date_url_uses_required_query_values(self):
        self.assertEqual(
            build_date_url(date(2026, 9, 29)),
            "https://www.medigatenews.com/section/date?date=2026-09-29&allOfDateFlag=N",
        )

    def test_collector_starts_from_kst_calendar_date_and_uses_next_date(self):
        calls = []
        now = datetime(2026, 9, 30, 15, 30, tzinfo=timezone.utc)
        item = make_item(
            2891932372,
            "KST 날짜 확인",
            int(datetime(2026, 9, 29, 8, 36, 36, tzinfo=timezone.utc).timestamp() * 1000),
        )

        def fetch(cursor):
            calls.append(cursor)
            if cursor == date(2026, 10, 1):
                return make_page("2026-10-01", "2026-09-29", [])
            if cursor == date(2026, 9, 29):
                return make_page("2026-09-29", "2026-09-22", [item])
            raise AssertionError("unexpected date cursor")

        articles = collect_recent_articles(fetch, now=now)
        self.assertEqual(calls, [date(2026, 10, 1), date(2026, 9, 29)])
        self.assertEqual(articles[0]["url"], "https://www.medigatenews.com/news/2891932372")

    def test_cutoff_filters_by_display_modified_timestamp(self):
        after_cutoff = int(datetime(2026, 9, 24, 3, 1, tzinfo=timezone.utc).timestamp() * 1000)
        before_cutoff = int(datetime(2026, 9, 24, 2, 59, tzinfo=timezone.utc).timestamp() * 1000)
        items = [
            make_item(1001, "cutoff 포함", after_cutoff),
            make_item(1002, "cutoff 제외", before_cutoff),
        ]
        page = make_page("2026-09-24", "2026-09-23", items)
        articles = collect_recent_articles(lambda _cursor: page, now=NOW)

        self.assertEqual([article["title"] for article in articles], ["cutoff 포함"])

    def test_duplicate_news_id_across_date_cursors_is_kept_once(self):
        calls = []
        article = make_item(2302962946, "같은 기사", 1790600256000)

        def fetch(cursor):
            calls.append(cursor)
            if cursor == date(2026, 10, 1):
                return make_page("2026-10-01", "2026-09-30", [article])
            return make_page("2026-09-30", "2026-09-23", [article])

        articles = collect_recent_articles(fetch, now=NOW)
        self.assertEqual(len(articles), 1)

    def test_missing_next_date_before_cutoff_fails(self):
        page = b'{"list":[{"date":"2026-10-01","newsList":[]}]}'
        with self.assertRaisesRegex(MedigateSourceError, "nextDate missing"):
            collect_recent_articles(lambda _cursor: page, now=NOW)

    def test_invalid_next_date_fails(self):
        page = b'{"list":[],"nextDate":"yesterday"}'
        with self.assertRaisesRegex(MedigateSourceError, "nextDate date"):
            collect_recent_articles(lambda _cursor: page, now=NOW)

    def test_repeated_next_date_fails(self):
        page = make_page("2026-10-01", "2026-10-01", [])
        with self.assertRaisesRegex(MedigateSourceError, "repeated nextDate"):
            collect_recent_articles(lambda _cursor: page, now=NOW)

    def test_forward_next_date_fails(self):
        page = make_page("2026-10-01", "2026-10-02", [])
        with self.assertRaisesRegex(MedigateSourceError, "move backward"):
            collect_recent_articles(lambda _cursor: page, now=NOW)

    def test_max_iteration_guard_fails_instead_of_looping(self):
        def fetch(cursor):
            return make_page(cursor.isoformat(), (cursor - timedelta(days=1)).isoformat(), [])

        with self.assertRaisesRegex(MedigateSourceError, "maximum date iterations"):
            collect_recent_articles(fetch, now=NOW, max_iterations=2)

    def test_output_never_builds_google_news_links(self):
        article = make_item(2302962946, "원문 링크", 1790600256000)
        page = make_page("2026-09-28", "2026-09-23", [article])
        records = collect_recent_articles(lambda _cursor: page, now=NOW)

        self.assertEqual(records[0]["source"], "메디게이트뉴스")
        self.assertEqual(records[0]["url"], "https://www.medigatenews.com/news/2302962946")
        self.assertNotIn("news.google.com", records[0]["url"])


if __name__ == "__main__":
    unittest.main()
