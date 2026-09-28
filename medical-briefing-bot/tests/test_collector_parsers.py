from datetime import datetime, timezone
from pathlib import Path
import unittest

import feedparser

from collector_parsers import (
    has_hira_target_board,
    is_valid_article_record,
    normalize_rss_entry,
    parse_hira_ssv_response,
    parse_kdca_press_release_html,
    parse_rss_entries,
)


FIXTURES = Path(__file__).parent / "fixtures"
NOW = datetime(2026, 9, 28, 5, 0, tzinfo=timezone.utc)
KDCA_LIST_URL = "https://www.kdca.go.kr/bbs/kdca/42/artclList.do"


def fixture_text(name):
    return (FIXTURES / name).read_text(encoding="utf-8").replace("\\x1e", "\x1e").replace("\\x1f", "\x1f")


class CollectorParserTests(unittest.TestCase):
    def test_normal_rss_fixture_produces_valid_article(self):
        parsed = feedparser.parse(fixture_text("rss-normal.xml"))
        result = parse_rss_entries(parsed.entries, "https://example.test/rss", "기관", now=NOW)
        self.assertEqual((result["raw_entries"], result["valid_entries"]), (1, 1))
        self.assertEqual(result["articles"][0]["url"], "https://example.test/news/1")

    def test_empty_rss_fixture_is_healthy_zero_entries(self):
        parsed = feedparser.parse(fixture_text("rss-empty.xml"))
        result = parse_rss_entries(parsed.entries, "https://example.test/rss", "기관", now=NOW)
        self.assertEqual((result["raw_entries"], result["valid_entries"]), (0, 0))
        self.assertEqual(result["articles"], [])

    def test_rss_invalid_entry_is_counted_and_skipped_with_valid_entries(self):
        entries = [
            {"title": "정상 공지", "link": "https://example.test/1"},
            {"title": "", "link": "https://example.test/2"},
        ]
        result = parse_rss_entries(entries, "https://example.test/rss", "기관", now=NOW)
        self.assertEqual(
            (result["raw_entries"], result["valid_entries"], result["invalid_entries"]),
            (2, 1, 1),
        )
        self.assertEqual([article["title"] for article in result["articles"]], ["정상 공지"])

    def test_unsupportable_rss_placeholder_fails_loudly(self):
        entries = [{"title": "This board unsupportable RSS function.", "link": ""}]
        with self.assertRaisesRegex(ValueError, "RSS 유효 article entry가 없습니다"):
            parse_rss_entries(entries, "https://example.test/rss", "질병관리청", now=NOW)

    def test_rss_not_supported_placeholder_fails_loudly(self):
        entries = [{"title": "RSS not supported", "link": "https://example.test/"}]
        with self.assertRaisesRegex(ValueError, "invalid_entries=1"):
            parse_rss_entries(entries, "https://example.test/rss", "질병관리청", now=NOW)

    def test_rss_press_filter_keeps_existing_filter_behavior(self):
        entries = [
            {"title": "건강보험 급여기준 안내", "link": "https://example.test/1"},
            {"title": "행사 안내", "link": "https://example.test/2"},
        ]
        result = parse_rss_entries(
            entries, "https://example.test/rss", "언론", now=NOW, is_press=True,
            press_filter=lambda title: "건강보험" in title,
        )
        self.assertEqual((result["valid_entries"], result["recent_entries"]), (2, 2))
        self.assertEqual((result["filtered_entries"], len(result["articles"])), (1, 1))

    def test_invalid_rss_url_is_rejected(self):
        result = normalize_rss_entry(
            {"title": "x", "link": "javascript:alert(1)"}, "https://example.test/rss"
        )
        self.assertIsNone(result)

    def test_relative_rss_url_is_normalized(self):
        result = normalize_rss_entry(
            {"title": "공지", "link": "../notice/1"}, "https://example.test/rss/feed.xml"
        )
        self.assertEqual(result, ("공지", "https://example.test/notice/1"))

    def test_db_boundary_rejects_kdca_placeholder(self):
        article = {"title": "This board unsupportable RSS function.", "url": "https://example.test/"}
        self.assertFalse(is_valid_article_record(article))

    def test_db_boundary_rejects_invalid_url(self):
        self.assertFalse(is_valid_article_record({"title": "공지", "url": "file:///tmp/article"}))

    def test_db_boundary_accepts_valid_article(self):
        self.assertTrue(is_valid_article_record({"title": "공지", "url": "https://example.test/article"}))

    def test_kdca_normal_html_fixture_produces_article(self):
        result = parse_kdca_press_release_html(fixture_text("kdca-list.html"), KDCA_LIST_URL, now=NOW)
        self.assertEqual(len(result["articles"]), 1)
        self.assertTrue(result["articles"][0]["url"].endswith("/42/12345/artclView.do"))

    def test_kdca_dom_article_link_is_extracted(self):
        result = parse_kdca_press_release_html(fixture_text("kdca-list.html"), KDCA_LIST_URL, now=NOW)
        self.assertEqual(result["articles"][0]["title"], "예방접종 정책 안내")

    def test_kdca_missing_article_url_uses_title_search_fallback(self):
        result = parse_kdca_press_release_html(
            fixture_text("kdca-list-title-only.html"), KDCA_LIST_URL, now=NOW
        )
        self.assertEqual(len(result["articles"]), 1)
        self.assertTrue(result["articles"][0]["url"].startswith(f"{KDCA_LIST_URL}?page=1"))
        self.assertIn("%EA%B0%90", result["articles"][0]["url"])

    def test_hira_target_ssv_fixture_keeps_target_source_name(self):
        articles, has_dataset = parse_hira_ssv_response(fixture_text("hira-target.ssv"), now=NOW)
        self.assertTrue(has_dataset)
        self.assertEqual(len(articles), 1)
        self.assertEqual(articles[0]["source"], "심평원 업무포탈 (자보알림방)")
        self.assertTrue(has_hira_target_board(articles))

    def test_hira_other_board_response_does_not_match_target(self):
        articles, has_dataset = parse_hira_ssv_response(fixture_text("hira-notice.ssv"), now=NOW)
        self.assertTrue(has_dataset)
        self.assertEqual(len(articles), 1)
        self.assertEqual(articles[0]["source"], "심평원 업무포탈 (공지사항)")
        self.assertFalse(has_hira_target_board(articles))

    def test_hira_malformed_ssv_does_not_create_article(self):
        articles, has_dataset = parse_hira_ssv_response(fixture_text("hira-malformed.ssv"), now=NOW)
        self.assertTrue(has_dataset)
        self.assertEqual(articles, [])

    def test_hira_empty_response_has_no_board_dataset(self):
        articles, has_dataset = parse_hira_ssv_response(fixture_text("hira-empty.ssv"), now=NOW)
        self.assertFalse(has_dataset)
        self.assertEqual(articles, [])


if __name__ == "__main__":
    unittest.main()
