from datetime import datetime, timezone
import json
from pathlib import Path
import ssl
import unittest
from unittest.mock import Mock, patch

import requests
from collector_lifecycle import find_absent_article_urls
from collector_sources import dailymedi


FIXTURES = Path(__file__).parent / "fixtures"
PREFIX = "DailyMedi request diagnostic: "
RUNTIME_PREFIX = "DailyMedi runtime diagnostic: "
NOW = datetime(2026, 10, 1, 3, 0, tzinfo=timezone.utc)
LISTING_URL = "https://www.dailymedi.com/news/news_list.php?ca_id=22&page=1"


def response(url, text, headers=None):
    result = Mock()
    result.url = url
    result.text = text
    result.content = text.encode("utf-8")
    result.status_code = 200
    result.headers = headers or {"content-type": "text/html; charset=utf-8"}
    result.history = []
    result.raise_for_status.return_value = None
    return result


def records(logs, prefix=PREFIX):
    return [
        json.loads(line[len(prefix):])
        for line in logs
        if line.startswith(prefix)
    ]


def listing_html(article_id, title, published_at):
    return (
        '<div class="listNews"><ul class="webzin main2"><li>'
        f'<a href="/news/news_view.php?ca_id=22&amp;wr_id={article_id}">'
        f'<span class="stitle">{title}</span></a>'
        f'<span class="news_list_date">{published_at}</span>'
        "</li></ul></div>"
    )


class DailyMediTlsDiagnosticsTests(unittest.TestCase):
    def test_ssl_eof_retry_then_success_logs_recovery_without_request_secrets(self):
        fake_secret = "FAKE_SUPABASE_KEY_DO_NOT_LOG"
        error = requests.exceptions.SSLError(fake_secret)
        error.__cause__ = ssl.SSLEOFError(8, fake_secret)
        html = (FIXTURES / "dailymedi-list.html").read_text(encoding="utf-8")
        logs = []

        with patch.object(dailymedi.requests, "get", side_effect=[error, response(LISTING_URL, html)]) as get, \
            patch.object(dailymedi.time, "sleep") as sleep, \
            patch("builtins.print", side_effect=logs.append):
            result = dailymedi._fetch_text(LISTING_URL)

        self.assertEqual(result, html)
        self.assertEqual(get.call_count, 2)
        self.assertEqual(get.call_args_list[0], get.call_args_list[1])
        self.assertEqual(get.call_args.kwargs["timeout"], (5, 20))
        self.assertTrue(get.call_args.kwargs["allow_redirects"])
        sleep.assert_called_once_with(1)

        diagnostics = records(logs)
        self.assertEqual(
            [(item["attempt"], item["result"], item["classification"]) for item in diagnostics],
            [(1, "retry", "ssl_eof"), (2, "success", None)],
        )
        self.assertEqual(diagnostics[0]["request_type"], "list")
        self.assertEqual(diagnostics[0]["section"], "22")
        self.assertEqual(diagnostics[0]["page"], "1")
        self.assertEqual(diagnostics[0]["max_attempts"], 3)
        self.assertEqual(diagnostics[0]["exception_class"], "SSLError")
        self.assertIsInstance(diagnostics[0]["elapsed_ms"], int)
        self.assertNotIn(fake_secret, "\n".join(logs))
        self.assertNotIn("https://", "\n".join(logs))

    def test_three_ssl_failures_log_exhaustion_without_changing_retry_count(self):
        fake_secret = "FAKE_LAW_CREDENTIAL_DO_NOT_LOG"
        error = requests.exceptions.SSLError(fake_secret)
        logs = []

        with patch.object(dailymedi.requests, "get", side_effect=[error, error, error]) as get, \
            patch.object(dailymedi.time, "sleep") as sleep, \
            patch("builtins.print", side_effect=logs.append):
            with self.assertRaises(requests.exceptions.SSLError):
                dailymedi._fetch_text(LISTING_URL)

        self.assertEqual(get.call_count, 3)
        self.assertEqual([call.args[0] for call in sleep.call_args_list], [1, 2])
        diagnostics = records(logs)
        self.assertEqual([item["result"] for item in diagnostics], ["retry", "retry", "exhausted"])
        self.assertEqual([item["attempt"] for item in diagnostics], [1, 2, 3])
        self.assertTrue(all(item["classification"] == "unknown_ssl" for item in diagnostics))
        self.assertTrue(all(item["request_type"] == "list" for item in diagnostics))
        self.assertTrue(all(item["section"] == "22" and item["page"] == "1" for item in diagnostics))
        self.assertNotIn(fake_secret, "\n".join(logs))
        self.assertNotIn("https://", "\n".join(logs))

    def test_exhausted_listing_request_keeps_partial_articles_and_suppresses_absence(self):
        recent = listing_html("940001", "확보한 기사", "2026-10-01 06:19")
        error = requests.exceptions.SSLError("opaque")
        logs = []

        def get(url, **_kwargs):
            if "page=1" in url:
                return response(url, recent)
            raise error

        with patch.object(dailymedi.requests, "get", side_effect=get), \
            patch.object(dailymedi.time, "sleep"), \
            patch("builtins.print", side_effect=logs.append):
            result = dailymedi.collect_recent_articles(
                dailymedi._fetch_text,
                dailymedi._fetch_article_date,
                now=NOW,
                sections=("22",),
                max_pages=3,
            )

        self.assertFalse(result.complete)
        self.assertEqual(result.reason_code, "list-request-SSLError")
        self.assertEqual(len(result.articles), 1)
        self.assertIn("wr_id=940001", result.articles[0]["url"])
        old_rows = [
            {"source": "데일리메디", "url": "https://www.dailymedi.com/news/news_view.php?wr_id=940001"},
            {"source": "데일리메디", "url": "https://www.dailymedi.com/news/news_view.php?wr_id=940002"},
        ]
        self.assertEqual(find_absent_article_urls(old_rows, result.articles, {"데일리메디"}), set())
        page_two = [item for item in records(logs) if item["page"] == "2"]
        self.assertEqual([item["result"] for item in page_two], ["retry", "retry", "exhausted"])
        self.assertEqual(page_two[-1]["request_type"], "list")
        self.assertEqual(page_two[-1]["page"], "2")
        self.assertNotIn("?ca_id=", "\n".join(logs))

    def test_detail_request_is_distinct_and_logs_only_numeric_article_identity(self):
        fake_secret = "FAKE_TOKEN_DO_NOT_LOG"
        url = (
            "https://www.dailymedi.com/news/news_view.php"
            "?ca_id=22&wr_id=940777&token=" + fake_secret
        )
        error = requests.exceptions.SSLError(fake_secret)
        error.request = Mock(headers={"Authorization": fake_secret, "Cookie": fake_secret})
        sensitive_headers = {
            "content-type": "text/html; charset=utf-8",
            "authorization": fake_secret,
            "set-cookie": fake_secret,
        }
        logs = []

        with patch.object(dailymedi.requests, "get", side_effect=[error, response(url, "<html></html>", sensitive_headers)]), \
            patch.object(dailymedi.time, "sleep"), \
            patch("builtins.print", side_effect=logs.append):
            dailymedi._fetch_text(url)

        diagnostics = records(logs)
        self.assertEqual(len(diagnostics), 2)
        self.assertEqual(diagnostics[0]["request_type"], "detail")
        self.assertEqual(diagnostics[0]["section"], "22")
        self.assertIsNone(diagnostics[0]["page"])
        self.assertEqual(diagnostics[0]["article_id"], "940777")
        combined = "\n".join(logs)
        self.assertNotIn(fake_secret, combined)
        self.assertNotIn("token=", combined)
        self.assertNotIn("wr_id=", combined)
        self.assertNotIn("https://", combined)
        self.assertNotIn("authorization", combined.lower())
        self.assertNotIn("cookie", combined.lower())

    def test_connect_timeout_is_classified_without_message(self):
        error = requests.exceptions.ConnectTimeout("private detail")
        self.assertEqual(dailymedi._classify_transient_error(error), "timeout_connect")

    def test_read_timeout_is_classified_without_message(self):
        error = requests.exceptions.ReadTimeout("private detail")
        self.assertEqual(dailymedi._classify_transient_error(error), "timeout_read")

    def test_chunked_encoding_error_is_classified(self):
        error = requests.exceptions.ChunkedEncodingError("private detail")
        self.assertEqual(dailymedi._classify_transient_error(error), "chunked_encoding")

    def test_unknown_ssl_cause_uses_safe_fallback_classification(self):
        error = requests.exceptions.SSLError("private detail")
        self.assertEqual(dailymedi._classify_transient_error(error), "unknown_ssl")

    def test_handshake_reason_is_classified_without_logging_reason_text(self):
        error = ssl.SSLError("private detail")
        error.reason = "TLSV1_ALERT_HANDSHAKE_FAILURE"
        self.assertEqual(dailymedi._classify_transient_error(error), "ssl_handshake")

    def test_runtime_diagnostic_contains_versions_but_no_environment_values(self):
        logs = []
        collection = Mock()
        with patch("builtins.print", side_effect=logs.append), \
            patch.object(dailymedi, "collect_recent_articles", return_value=collection) as collect:
            result = dailymedi.fetch_dailymedi_articles()

        self.assertIs(result, collection)
        collect.assert_called_once()
        runtime_logs = [line for line in logs if line.startswith(RUNTIME_PREFIX)]
        self.assertEqual(len(runtime_logs), 1)
        payload = json.loads(runtime_logs[0][len(RUNTIME_PREFIX):])
        self.assertEqual(
            set(payload),
            {"python_version", "requests_version", "urllib3_version", "openssl_version"},
        )
        self.assertTrue(all(isinstance(value, str) and value for value in payload.values()))


if __name__ == "__main__":
    unittest.main()
