from datetime import datetime, timezone
import unittest
from urllib.parse import parse_qs, urlparse

from collector_lifecycle import find_absent_article_urls
from collector_sources import dailymedi
from collector_sources.dailymedi import collect_recent_articles


NOW = datetime(2026, 10, 1, 3, 0, tzinfo=timezone.utc)


def listing_html(article_id: int, title: str, published_at: str) -> str:
    return (
        '<div class="listNews"><ul class="webzin main2"><li>'
        f'<a href="/news/news_view.php?ca_id=22&amp;wr_id={article_id}">'
        f'<span class="stitle">{title}</span></a>'
        f'<span class="news_list_date">{published_at}</span>'
        "</li></ul></div>"
    )


class DailyMediPaginationCompletionTests(unittest.TestCase):
    def test_thirteen_page_window_reaches_date_cutoff_and_completes(self):
        requested_pages = []

        def fetch(url: str) -> str:
            page_number = int(parse_qs(urlparse(url).query)["page"][0])
            requested_pages.append(page_number)
            if page_number < 13:
                return listing_html(page_number, f"최근 기사 {page_number}", "2026-10-01 06:19")
            return listing_html(13, "과거 기사", "2026-09-20 06:19")

        collection = collect_recent_articles(
            fetch,
            lambda _url: None,
            now=NOW,
            sections=("22",),
        )

        self.assertTrue(collection.complete, "collection should stop after reaching the seven-day cutoff")
        self.assertIsNone(collection.reason_code)
        self.assertEqual(len(collection.articles), 12)
        self.assertEqual(requested_pages, list(range(1, 14)))

    def test_safety_cap_without_cutoff_stays_incomplete_and_suppresses_absence(self):
        requested_pages = []

        def fetch(url: str) -> str:
            page_number = int(parse_qs(urlparse(url).query)["page"][0])
            requested_pages.append(page_number)
            return listing_html(page_number, f"최근 기사 {page_number}", "2026-10-01 06:19")

        collection = collect_recent_articles(
            fetch,
            lambda _url: None,
            now=NOW,
            sections=("22",),
        )
        existing = [
            {"source": "데일리메디", "url": "https://www.dailymedi.com/news/news_view.php?wr_id=old"},
        ]

        self.assertFalse(collection.complete)
        self.assertEqual(collection.reason_code, "maximum-pages-reached")
        self.assertEqual(len(collection.articles), dailymedi.MAX_PAGES_PER_SECTION)
        self.assertEqual(requested_pages, list(range(1, dailymedi.MAX_PAGES_PER_SECTION + 1)))
        self.assertEqual(
            find_absent_article_urls(existing, collection.articles, {"데일리메디"}),
            set(),
        )


if __name__ == "__main__":
    unittest.main()
