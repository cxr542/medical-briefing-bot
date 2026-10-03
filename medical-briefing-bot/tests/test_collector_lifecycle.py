import unittest

from collector_lifecycle import find_absent_article_urls


class CollectorLifecycleTests(unittest.TestCase):
    def test_incomplete_dailymedi_snapshot_does_not_mark_unseen_pages_deleted(self):
        existing = [
            {"source": "데일리메디", "url": "https://www.dailymedi.com/news/news_view.php?wr_id=1"},
            {"source": "데일리메디", "url": "https://www.dailymedi.com/news/news_view.php?wr_id=3"},
        ]
        collected = [
            {"source": "데일리메디", "url": "https://www.dailymedi.com/news/news_view.php?wr_id=1"},
            {"source": "데일리메디", "url": "https://www.dailymedi.com/news/news_view.php?wr_id=2"},
        ]

        absent = find_absent_article_urls(existing, collected, {"데일리메디"})

        self.assertEqual(absent, set())

    def test_complete_dailymedi_snapshot_still_marks_absent_urls(self):
        existing = [
            {"source": "데일리메디", "url": "https://www.dailymedi.com/news/news_view.php?wr_id=1"},
            {"source": "데일리메디", "url": "https://www.dailymedi.com/news/news_view.php?wr_id=3"},
        ]
        collected = [
            {"source": "데일리메디", "url": "https://www.dailymedi.com/news/news_view.php?wr_id=1"},
        ]

        absent = find_absent_article_urls(existing, collected, set())

        self.assertEqual(absent, {"https://www.dailymedi.com/news/news_view.php?wr_id=3"})

    def test_incomplete_dailymedi_does_not_suppress_other_source_reconciliation(self):
        existing = [
            {"source": "데일리메디", "url": "https://www.dailymedi.com/news/news_view.php?wr_id=3"},
            {"source": "의학신문", "url": "https://www.bosa.co.kr/news/articleView.html?idxno=1"},
        ]
        collected = [
            {"source": "데일리메디", "url": "https://www.dailymedi.com/news/news_view.php?wr_id=1"},
            {"source": "의학신문", "url": "https://www.bosa.co.kr/news/articleView.html?idxno=2"},
        ]

        absent = find_absent_article_urls(existing, collected, {"데일리메디"})

        self.assertEqual(absent, {"https://www.bosa.co.kr/news/articleView.html?idxno=1"})

    def test_failed_empty_source_does_not_reconcile_old_rows(self):
        existing = [
            {"source": "데일리메디", "url": "https://www.dailymedi.com/news/news_view.php?wr_id=3"},
        ]

        absent = find_absent_article_urls(existing, [], set())

        self.assertEqual(absent, set())


if __name__ == "__main__":
    unittest.main()
