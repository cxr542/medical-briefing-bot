from datetime import datetime, timedelta, timezone
from pathlib import Path
import unittest
from unittest.mock import Mock, patch
from urllib.parse import parse_qs, urlparse

import requests
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
    def test_medibox_sections_keep_article_title_and_fetch_missing_date(self):
        html = '<div class="listNews mediBox"><ul><li><div class="subject ml_subject"><a href="/news/news_view.php?wr_id=941101"><span class="cate2">인사</span> 새 기관장 취임</a></div><div class="ml_date"></div></li><li class="mb_banner"></li></ul></div>'
        requested = []
        for section in ("21", "31"):
            with self.subTest(section=section):
                page = parse_list_page(html, LIST_URL.replace("ca_id=22", "ca_id=" + section), cutoff=CUTOFF, now=NOW, fetch_article_date=lambda url: requested.append(url) or NOW)
                self.assertEqual(len(page.articles), 1)
                self.assertEqual(page.articles[0].title, "새 기관장 취임")
                self.assertEqual(page.articles[0].published_at, NOW)
        self.assertEqual(len(requested), 2)

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
        self.assertEqual(len(articles), 1)
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
        self.assertEqual(len(articles), 1)
        self.assertEqual(articles[0]["url"], "https://www.dailymedi.com/news/news_view.php?ca_id=22&wr_id=9")

    def test_records_use_direct_url_and_collector_article_schema(self):
        html = fixture_text("dailymedi-list.html")
        articles = collect_recent_articles(
            lambda _url: html,
            lambda _url: NOW,
            now=NOW,
            sections=("22",),
            max_pages=1,
        )
        self.assertEqual(articles[0]["source"], "데일리메디")
        self.assertEqual(set(articles[0]), {"source", "title", "url", "published_date", "content_hash", "status"})
        self.assertTrue(all("dailymedi.com/news/news_view.php" in article["url"] for article in articles))
        self.assertFalse(any("news.google.com" in article["url"] for article in articles))


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
            return Mock(text=html, url=url)

        with patch.object(dailymedi.requests, "get", side_effect=get), patch.object(dailymedi.time, "sleep") as sleep:
            articles = collect_recent_articles(dailymedi._fetch_text, lambda _url: None, now=NOW, sections=("22",), max_pages=5)
        return articles, attempts, sleep

    def test_page_four_recovers_after_ssl_retry_and_deduplicates(self):
        articles, attempts, sleep = self.run_collection(failures=2)
        self.assertEqual(attempts[4], 3)
        self.assertEqual(sleep.call_args_list, [unittest.mock.call(1), unittest.mock.call(2)])
        self.assertEqual(len(articles), 5)
        self.assertEqual(len({article["url"] for article in articles}), 5)
        self.assertTrue(all(article["url"].startswith("https://www.dailymedi.com/news/news_view.php?") for article in articles))

    def test_page_four_exhausted_ssl_retries_preserves_previous_articles(self):
        articles, attempts, _sleep = self.run_collection(failures=3)
        self.assertEqual(len(articles), 3)
        self.assertEqual(attempts, {1: 1, 2: 1, 3: 1, 4: 3})

    def test_first_page_exhausted_retries_fails(self):
        with self.assertRaises(requests.exceptions.SSLError):
            self.run_collection(failures=3, fail_page=1)

    def test_later_malformed_markup_still_fails(self):
        with self.assertRaisesRegex(ValueError, "listing markup not found"):
            self.run_collection(malformed=True)

    def test_no_valid_articles_fails(self):
        with self.assertRaisesRegex(ValueError, "no recent valid articles"):
            self.run_collection(empty=True)

    def test_article_date_fallback_retries_transient_errors(self):
        response = Mock(text=fixture_text("dailymedi-article.html"), url="https://www.dailymedi.com/news/news_view.php?wr_id=1")
        for error in (requests.exceptions.ConnectionError, requests.exceptions.ConnectTimeout, requests.exceptions.ReadTimeout, requests.exceptions.ChunkedEncodingError):
            with self.subTest(error=error.__name__), patch.object(dailymedi.requests, "get", side_effect=[error("transient"), response]) as get, patch.object(dailymedi.time, "sleep"):
                self.assertEqual(dailymedi._fetch_article_date(response.url), datetime(2026, 9, 30, 21, 19, tzinfo=timezone.utc))
                self.assertEqual(get.call_count, 2)

    def test_http_error_is_not_partial_success_or_retried(self):
        response = Mock(url=LIST_URL)
        response.raise_for_status.side_effect = requests.exceptions.HTTPError("403")
        with patch.object(dailymedi.requests, "get", return_value=response) as get, patch.object(dailymedi.time, "sleep") as sleep:
            with self.assertRaises(requests.exceptions.HTTPError):
                dailymedi._fetch_text(LIST_URL)
        self.assertEqual(get.call_count, 1)
        sleep.assert_not_called()


if __name__ == "__main__":
    unittest.main()
