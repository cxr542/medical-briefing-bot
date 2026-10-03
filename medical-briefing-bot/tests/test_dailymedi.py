from datetime import datetime, timedelta, timezone
from pathlib import Path
import unittest
from unittest.mock import Mock, patch
from urllib.parse import parse_qs, urlparse

import requests
from collector_lifecycle import find_absent_article_urls
from collector_sources import dailymedi

from collector_sources.dailymedi import (
    SECTION_IDS,
    collect_recent_articles,
    parse_article_page_date,
    parse_list_page,
)


FIXTURES = Path(__file__).parent / "fixtures"
NOW = datetime(2026, 10, 1, 3, 0, tzinfo=timezone.utc)
CUTOFF = NOW - timedelta(days=7)
LIST_URL = "https://www.dailymedi.com/news/news_list.php?ca_id=22&page=1"


def fixture_text(name):
    return (FIXTURES / name).read_text(encoding="utf-8")


class DailyMediParserTests(unittest.TestCase):
    def test_list_extracts_title_direct_relative_url_and_date(self):
        page = parse_list_page(
            fixture_text("dailymedi-list.html"),
            LIST_URL,
            cutoff=CUTOFF,
            now=NOW,
            fetch_article_date=lambda _url: None,
        )

        self.assertEqual(page.articles[0].title, "최근 데일리메디 기사")
        self.assertEqual(
            page.articles[0].url,
            "https://www.dailymedi.com/news/news_view.php?ca_id=22&wr_id=940999",
        )
        self.assertEqual(page.articles[0].wr_id, "940999")
        self.assertEqual(page.articles[0].published_at, datetime(2026, 9, 30, 21, 19, tzinfo=timezone.utc))

    def test_absolute_approved_host_is_preserved(self):
        html = '<div class="listNews"><ul class="webzin main2"><li><a href="https://dailymedi.com/news/news_view.php?wr_id=940998"><span class="stitle">제목</span></a><span class="news_list_date">2026.10.01 06:19</span></li></ul></div>'
        page = parse_list_page(html, LIST_URL, cutoff=CUTOFF, now=NOW)
        self.assertEqual(page.articles[0].url, "https://dailymedi.com/news/news_view.php?wr_id=940998")

    def test_article_page_metadata_fallback(self):
        self.assertEqual(
            parse_article_page_date(fixture_text("dailymedi-article.html")),
            datetime(2026, 9, 30, 21, 19, tzinfo=timezone.utc),
        )

    def test_missing_list_date_fetches_only_that_article(self):
        requested = []
        page = parse_list_page(
            fixture_text("dailymedi-list.html"),
            LIST_URL,
            cutoff=CUTOFF,
            now=NOW,
            fetch_article_date=lambda url: requested.append(url) or NOW,
        )
        self.assertEqual(len(requested), 1)
        self.assertTrue(requested[0].endswith("wr_id=941000"))
        self.assertEqual(page.articles[1].published_at, NOW)

    def test_failed_detail_date_uses_current_time(self):
        def fail(_url):
            raise RuntimeError("offline")

        page = parse_list_page(
            fixture_text("dailymedi-list.html"),
            LIST_URL,
            cutoff=CUTOFF,
            now=NOW,
            fetch_article_date=fail,
        )
        self.assertEqual(page.articles[1].published_at, NOW)

    def test_unapproved_hosts_and_malformed_article_identifiers_are_rejected(self):
        page = parse_list_page(fixture_text("dailymedi-list.html"), LIST_URL, cutoff=CUTOFF, now=NOW)
        self.assertEqual([item.wr_id for item in page.articles], ["940999", "941000"])

    def test_unexpected_listing_markup_fails_instead_of_healthy_zero(self):
        with self.assertRaisesRegex(ValueError, "listing markup not found"):
            parse_list_page("<html><body>차단 페이지</body></html>", LIST_URL, cutoff=CUTOFF, now=NOW)

    def test_cutoff_stops_each_section_after_all_old_articles(self):
        calls = []
        current = '<div class="listNews"><ul class="webzin main2"><li><a href="/news/news_view.php?wr_id=1"><span class="stitle">최근</span></a><span class="news_list_date">2026-10-01 06:19</span></li></ul></div>'
        old = '<div class="listNews"><ul class="webzin main2"><li><a href="/news/news_view.php?wr_id=2"><span class="stitle">과거</span></a><span class="news_list_date">2026-09-20 06:19</span></li></ul></div>'

        def fetch(url):
            calls.append(url)
            return current if "page=1" in url else old

        articles = collect_recent_articles(fetch, lambda _url: None, now=NOW, sections=("22",), max_pages=10)
        self.assertTrue(articles.complete)
        self.assertEqual(len(articles.articles), 1)
        self.assertTrue(articles.articles[0]["url"].startswith("https://www.dailymedi.com/"))
        self.assertEqual(len(calls), 2)

    def test_wr_id_deduplicates_across_sections_and_pages(self):
        html = '<div class="listNews"><ul class="webzin main2"><li><a href="/news/news_view.php?ca_id=22&amp;wr_id=9"><span class="stitle">같은 기사</span></a><span class="news_list_date">2026-10-01 06:19</span></li></ul></div>'
        articles = collect_recent_articles(
            lambda _url: html,
            lambda _url: None,
            now=NOW,
            sections=SECTION_IDS,
            max_pages=3,
        )
        self.assertFalse(articles.complete)
        self.assertEqual(len(articles.articles), 1)
        self.assertEqual(articles.articles[0]["url"], "https://www.dailymedi.com/news/news_view.php?ca_id=22&wr_id=9")

    def test_records_use_direct_url_and_collector_article_schema(self):
        html = fixture_text("dailymedi-list.html")
        articles = collect_recent_articles(
            lambda _url: html,
            lambda _url: NOW,
            now=NOW,
            sections=("22",),
            max_pages=1,
        )
        self.assertFalse(articles.complete)
        self.assertEqual(articles.articles[0]["source"], "데일리메디")
        self.assertEqual(set(articles.articles[0]), {"source", "title", "url", "published_date", "content_hash", "status"})
        self.assertTrue(all("dailymedi.com/news/news_view.php" in article["url"] for article in articles.articles))
        self.assertFalse(any("news.google.com" in article["url"] for article in articles.articles))


class DailyMediNetworkTests(unittest.TestCase):
    def run_collection(self, failures=0, fail_page=4, malformed=False, empty=False):
        attempts = {}

        def get(url, **kwargs):
            self.assertNotEqual(kwargs.get("verify"), False)
            page = int(parse_qs(urlparse(url).query)["page"][0])
            attempts[page] = attempts.get(page, 0) + 1
            if page == fail_page and attempts[page] <= failures:
                raise requests.exceptions.SSLError("TLS EOF")
            html = (
                '<div class="listNews"><ul class="webzin main2">'
                f'<li><a href="/news/news_view.php?wr_id={page}">'
                '<span class="stitle">Article</span></a>'
                '<span class="news_list_date">2026-10-01 06:19</span></li>'
                '<li><a href="/news/news_view.php?wr_id=1">'
                '<span class="stitle">Duplicate</span></a>'
                '<span class="news_list_date">2026-10-01 06:19</span></li>'
                '</ul></div>'
            )
            if malformed and page == fail_page:
                html = '<html>blocked</html>'
            if empty:
                html = '<div class="listNews"><ul class="webzin main2"></ul></div>'
            if page == 6:
                html = html.replace("2026-10-01", "2026-09-20")
            return Mock(
                text=html,
                content=html.encode("utf-8"),
                url=url,
                status_code=200,
                headers={"content-type": "text/html; charset=utf-8"},
                history=[],
            )

        with patch.object(dailymedi.requests, "get", side_effect=get), patch.object(dailymedi.time, "sleep") as sleep:
            articles = collect_recent_articles(dailymedi._fetch_text, lambda _url: None, now=NOW, sections=("22",), max_pages=6)
        return articles, attempts, sleep

    def test_page_four_recovers_after_ssl_retry_and_deduplicates(self):
        articles, attempts, sleep = self.run_collection(failures=2)
        self.assertEqual(attempts[4], 3)
        self.assertEqual(sleep.call_args_list, [unittest.mock.call(1), unittest.mock.call(2)])
        self.assertTrue(articles.complete)
        self.assertEqual(len(articles.articles), 5)
        self.assertEqual(len({article["url"] for article in articles.articles}), 5)
        self.assertTrue(all(article["url"].startswith("https://www.dailymedi.com/news/news_view.php?") for article in articles.articles))

    def test_page_four_exhausted_ssl_retries_preserves_previous_articles(self):
        articles, attempts, _sleep = self.run_collection(failures=3)
        self.assertFalse(articles.complete)
        self.assertEqual(articles.reason_code, "list-request-SSLError")
        self.assertEqual(len(articles.articles), 3)
        self.assertEqual(attempts, {1: 1, 2: 1, 3: 1, 4: 3})

    def test_first_page_exhausted_retries_fails(self):
        articles, attempts, _sleep = self.run_collection(failures=3, fail_page=1)
        self.assertFalse(articles.complete)
        self.assertEqual(articles.articles, ())
        self.assertEqual(articles.reason_code, "list-request-SSLError")
        self.assertEqual(attempts, {1: 3})
        old_article_rows = [
            {"source": "데일리메디", "url": "https://www.dailymedi.com/news/news_view.php?wr_id=3"},
        ]
        self.assertEqual(
            find_absent_article_urls(old_article_rows, articles.articles, {"데일리메디"}),
            set(),
        )

    def test_later_malformed_markup_still_fails(self):
        articles, _attempts, _sleep = self.run_collection(malformed=True)
        self.assertFalse(articles.complete)
        self.assertEqual(articles.reason_code, "listing-markup-invalid")
        self.assertEqual(len(articles.articles), 3)

    def test_first_page_unexpected_markup_does_not_reconcile_old_rows(self):
        articles, _attempts, _sleep = self.run_collection(malformed=True, fail_page=1)
        old_article_rows = [
            {"source": "데일리메디", "url": "https://www.dailymedi.com/news/news_view.php?wr_id=3"},
        ]

        self.assertFalse(articles.complete)
        self.assertEqual(articles.reason_code, "listing-markup-invalid")
        self.assertEqual(articles.articles, ())
        self.assertEqual(
            find_absent_article_urls(old_article_rows, articles.articles, {"데일리메디"}),
            set(),
        )

    def test_no_valid_articles_fails(self):
        articles, _attempts, _sleep = self.run_collection(empty=True)
        self.assertFalse(articles.complete)
        self.assertEqual(articles.reason_code, "no-recent-valid-articles")
        self.assertEqual(articles.articles, ())

    def test_article_date_fallback_retries_transient_errors(self):
        response = Mock(text=fixture_text("dailymedi-article.html"), url="https://www.dailymedi.com/news/news_view.php?wr_id=1")
        for error in (requests.exceptions.ConnectionError, requests.exceptions.ConnectTimeout, requests.exceptions.ReadTimeout, requests.exceptions.ChunkedEncodingError):
            with self.subTest(error=error.__name__), patch.object(dailymedi.requests, "get", side_effect=[error("transient"), response]) as get, patch.object(dailymedi.time, "sleep"):
                self.assertEqual(dailymedi._fetch_article_date(response.url), datetime(2026, 9, 30, 21, 19, tzinfo=timezone.utc))
                self.assertEqual(get.call_count, 2)

    def test_repeated_article_detail_failure_preserves_listed_articles(self):
        html = (
            '<div class="listNews"><ul class="webzin main2">'
            '<li><a href="/news/news_view.php?wr_id=10"><span class="stitle">dated</span></a>'
            '<span class="news_list_date">2026-10-01 06:19</span></li>'
            '<li><a href="/news/news_view.php?wr_id=11"><span class="stitle">missing date</span></a></li>'
            '</ul></div>'
        )
        old = '<div class="listNews"><ul class="webzin main2"></ul></div>'
        detail_attempts = 0

        def request(url, **_kwargs):
            nonlocal detail_attempts
            detail_attempts += 1
            raise requests.exceptions.SSLError("TLS EOF")

        def fetch_list(url):
            return html if "page=1" in url else old

        with patch.object(dailymedi.requests, "get", side_effect=request), patch.object(dailymedi.time, "sleep"):
            result = collect_recent_articles(
                fetch_list,
                dailymedi._fetch_article_date,
                now=NOW,
                sections=("22",),
                max_pages=4,
            )

        self.assertTrue(result.complete)
        self.assertEqual(detail_attempts, 3)
        self.assertEqual(len(result.articles), 2)
        self.assertTrue(all("dailymedi.com/news/news_view.php" in article["url"] for article in result.articles))

    def test_http_error_is_not_partial_success_or_retried(self):
        response = Mock(
            url=LIST_URL,
            text="forbidden",
            content=b"forbidden",
            status_code=403,
            headers={"content-type": "text/html"},
            history=[],
        )
        response.raise_for_status.side_effect = requests.exceptions.HTTPError("403")
        with patch.object(dailymedi.requests, "get", return_value=response) as get, patch.object(dailymedi.time, "sleep") as sleep:
            with self.assertRaises(requests.exceptions.HTTPError):
                dailymedi._fetch_text(LIST_URL)
        self.assertEqual(get.call_count, 1)
        sleep.assert_not_called()

    def test_unexpected_listing_response_logs_safe_metadata_without_body(self):
        body = "<html>block content with private detail</html>"
        response = Mock(
            url="https://www.dailymedi.com/blocked?private=query",
            text=body,
            content=body.encode("utf-8"),
            status_code=200,
            headers={"content-type": "text/html; charset=utf-8"},
            history=[Mock()],
        )
        logs = []

        with patch.object(dailymedi.requests, "get", return_value=response), patch("builtins.print", side_effect=logs.append):
            dailymedi._fetch_text(LIST_URL)

        self.assertEqual(len(logs), 1)
        self.assertIn("request_url=https://www.dailymedi.com/news/news_list.php?ca_id=22&page=1", logs[0])
        self.assertIn("final_url=https://www.dailymedi.com/blocked", logs[0])
        self.assertIn("status=200", logs[0])
        self.assertIn("content_type=text/html", logs[0])
        self.assertIn("response_bytes=", logs[0])
        self.assertIn("redirects=1", logs[0])
        self.assertIn("classification=missing-listing-selector", logs[0])
        self.assertNotIn("private=query", logs[0])
        self.assertNotIn("private detail", logs[0])

    def test_later_page_exhaustion_is_marked_incomplete(self):
        result, attempts, _sleep = self.run_collection(failures=3, fail_page=3)
        self.assertFalse(result.complete)
        self.assertEqual(result.reason_code, "list-request-SSLError")
        self.assertEqual(attempts, {1: 1, 2: 1, 3: 3})
        self.assertEqual(len(result.articles), 2)

        old_article_rows = [
            {"source": "데일리메디", "url": f"https://www.dailymedi.com/news/news_view.php?wr_id={article_id}"}
            for article_id in ("1", "2", "3")
        ]
        absent_urls = find_absent_article_urls(old_article_rows, result.articles, {"데일리메디"})
        self.assertEqual(absent_urls, set())


if __name__ == "__main__":
    unittest.main()
