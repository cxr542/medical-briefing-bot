from pathlib import Path
import sys
from types import ModuleType
import unittest
from unittest.mock import Mock, patch

import requests

PACKAGE_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(PACKAGE_ROOT))

supabase_stub = ModuleType("supabase")
supabase_stub.create_client = Mock(return_value=Mock())
supabase_stub.Client = object
dotenv_stub = ModuleType("dotenv")
dotenv_stub.load_dotenv = Mock(return_value=False)

with patch.dict(sys.modules, {"supabase": supabase_stub, "dotenv": dotenv_stub}):
    import collector

from collector_lifecycle import find_absent_article_urls


def page(*article_numbers):
    rows = "".join(
        f'<div class="tr"><span class="tb_03"><a href="?mode=view&articleNo={number}">공지 {number}</a></span>'
        f'<span class="tb_05">2026-11-0{number % 9 + 1}</span></div>'
        for number in article_numbers
    )
    return Mock(text=f"<html><body>{rows}</body></html>")


class KhaCollectionTests(unittest.TestCase):
    def collect(self, side_effect):
        with patch.object(collector, "get_with_transient_retry", side_effect=side_effect) as request, \
                patch("builtins.print"):
            return collector.fetch_kha_notices(), request

    def test_all_pages_collected_returns_plain_list_with_longer_read_timeout(self):
        result, request = self.collect([page(1, 2), page(3), page(4)])

        self.assertIsInstance(result, list)
        self.assertEqual(len(result), 4)
        self.assertEqual(request.call_count, 3)
        self.assertEqual(request.call_args.kwargs["timeout"], collector.KHA_TIMEOUT)
        self.assertGreaterEqual(collector.KHA_TIMEOUT[1], 30)

    def test_later_page_failure_keeps_earlier_pages_and_marks_incomplete(self):
        result, _request = self.collect([page(1, 2), requests.exceptions.ReadTimeout("slow")])

        self.assertIsInstance(result, collector.IncompleteCollection)
        self.assertFalse(result.complete)
        self.assertEqual(result.reason_code, "page-offset-10-ReadTimeout")
        self.assertEqual(len(result.articles), 2)

        existing = [{"source": "대한병원협회 공지사항", "url": "https://www.kha.or.kr/kha_home/notice_list.do?mode=view&articleNo=99"}]
        self.assertEqual(
            find_absent_article_urls(existing, result.articles, {"대한병원협회 공지사항"}),
            set(),
        )

    def test_first_page_failure_still_raises(self):
        with self.assertRaises(requests.exceptions.ReadTimeout):
            self.collect([requests.exceptions.ReadTimeout("slow")])


if __name__ == "__main__":
    unittest.main()
