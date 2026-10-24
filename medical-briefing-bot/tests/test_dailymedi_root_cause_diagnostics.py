from datetime import datetime, timedelta, timezone
import ssl
import unittest
from unittest.mock import call, patch

import requests
import urllib3

from collector_sources import dailymedi
from test_dailymedi_tls_diagnostics import LISTING_URL, records, response


NOW = datetime(2026, 10, 8, 6, 0, tzinfo=timezone.utc)
DATE_PREFIX = "DailyMedi date diagnostic: "
SUMMARY_PREFIX = "DailyMedi unresolved date summary: "
SECRET = "FAKE_TOKEN_COOKIE_KEY_DO_NOT_LOG"


def medibox_html(count=1):
    return '<div class="listNews mediBox"><ul>' + ''.join(
        '<li><div class="subject ml_subject">'
        f'<a href="/news/news_view.php?ca_id=21&amp;wr_id={941143 + index}">Article</a>'
        '</div></li>'
        for index in range(count)
    ) + '</ul></div>'


class DailyMediRootCauseDiagnosticsTests(unittest.TestCase):
    def test_wrapped_ssl_exhaustion_logs_structured_chain_and_preserves_retry(self):
        inner = ssl.SSLZeroReturnError(6, SECRET)
        wrapped = urllib3.exceptions.SSLError(inner)
        maximum = urllib3.exceptions.MaxRetryError(None, "/private?token=" + SECRET, wrapped)
        error = requests.exceptions.SSLError(maximum)
        error.__context__ = ConnectionResetError(SECRET)
        logs = []

        with patch.object(dailymedi.requests, "get", side_effect=error) as get, \
            patch.object(dailymedi.time, "sleep") as sleep, \
            patch("builtins.print", side_effect=logs.append):
            with self.assertRaises(requests.exceptions.SSLError):
                dailymedi._fetch_text(LISTING_URL)

        self.assertEqual(get.call_count, 3)
        self.assertEqual(sleep.call_args_list, [call(1), call(2)])
        logged = records(logs)
        self.assertEqual([item["retry_state"] for item in logged], ["retry", "retry", "exhausted"])
        self.assertEqual([item["attempt"] for item in logged], [1, 2, 3])
        self.assertEqual(logged[-1]["exception_type"], "SSLError")
        self.assertIsNone(logged[-1]["cause_type"])
        self.assertEqual(logged[-1]["context_type"], "ConnectionResetError")
        self.assertIn("SSLZeroReturnError", logged[-1]["exception_chain_types"])
        self.assertEqual(logged[-1]["ssl_reason"], "connection_closed")
        self.assertEqual(logged[-1]["source"], "dailymedi")
        self.assertEqual(logged[-1]["request_kind"], "list")
        self.assertNotIn(SECRET, "\n".join(logs))

    def test_last_attempt_recovery_keeps_request_options_and_legacy_fields(self):
        error = requests.exceptions.SSLError(SECRET)
        error.__cause__ = ssl.SSLEOFError(8, SECRET)
        logs = []
        html = '<div class="listNews"><ul class="webzin main2"></ul></div>'

        with patch.object(dailymedi.requests, "get", side_effect=[error, error, response(LISTING_URL, html)]) as get, \
            patch.object(dailymedi.time, "sleep") as sleep, \
            patch("builtins.print", side_effect=logs.append):
            result = dailymedi._fetch_text(LISTING_URL)

        self.assertEqual(result, html)
        self.assertEqual(get.call_count, 3)
        self.assertEqual(sleep.call_args_list, [call(1), call(2)])
        self.assertTrue(all(item.kwargs == get.call_args.kwargs for item in get.call_args_list))
        self.assertEqual(get.call_args.kwargs["timeout"], (5, 20))
        self.assertNotEqual(get.call_args.kwargs.get("verify"), False)
        self.assertEqual(get.call_args.kwargs["headers"], {"User-Agent": "Mozilla/5.0 (compatible; MedicalBriefingBot/1.0)"})
        logged = records(logs)
        self.assertEqual([item["result"] for item in logged], ["retry", "retry", "success"])
        self.assertEqual(logged[0]["classification"], "ssl_eof")
        self.assertEqual(logged[0]["cause_type"], "SSLEOFError")
        self.assertEqual(logged[0]["ssl_reason"], "unexpected_eof")
        self.assertEqual(logged[0]["exception_class"], "SSLError")
        self.assertIsNone(logged[-1]["ssl_reason"])

    def test_reason_normalization_uses_types_and_allowlisted_codes_only(self):
        handshake = ssl.SSLError(SECRET)
        handshake.reason = "TLSV1_ALERT_HANDSHAKE_FAILURE"
        protocol = ssl.SSLError(SECRET)
        protocol.reason = "WRONG_VERSION_NUMBER"
        unknown = requests.exceptions.SSLError("CERTIFICATE_VERIFY_FAILED " + SECRET)
        unknown.reason = SECRET
        cases = (
            (ssl.SSLCertVerificationError(1, SECRET), "certificate_verify_failed"),
            (ssl.SSLEOFError(8, SECRET), "unexpected_eof"),
            (handshake, "handshake_failure"),
            (protocol, "protocol_error"),
            (ConnectionResetError(SECRET), "connection_reset"),
            (requests.exceptions.ConnectTimeout(SECRET), "timeout"),
            (unknown, "unknown_ssl"),
        )

        for error, expected in cases:
            with self.subTest(expected=expected):
                self.assertEqual(dailymedi._ssl_reason(error), expected)

    def test_exception_chain_is_cycle_safe_and_bounded(self):
        error = requests.exceptions.SSLError(SECRET)
        error.__cause__ = error
        self.assertEqual(dailymedi._exception_chain(error), (error,))
        head = error
        for _ in range(40):
            parent = requests.exceptions.SSLError(SECRET)
            parent.__cause__ = head
            head = parent
        self.assertEqual(len(dailymedi._exception_chain(head)), 16)

    def collect_date_failure(self, detail):
        logs = []
        listing = medibox_html()

        def get(url, **_kwargs):
            if "news_list.php" in url:
                return response(url, listing)
            if isinstance(detail, Exception):
                raise detail
            return response(url, detail)

        with patch.object(dailymedi.requests, "get", side_effect=get) as get_mock, \
            patch.object(dailymedi.time, "sleep") as sleep, \
            patch("builtins.print", side_effect=logs.append):
            collection = dailymedi.collect_recent_articles(
                dailymedi._fetch_text, dailymedi._resolve_article_date,
                now=NOW, sections=("21",),
            )
        return collection, logs, get_mock, sleep

    def test_detail_request_failure_is_distinct_from_html_date_failure(self):
        collection, logs, get, sleep = self.collect_date_failure(requests.exceptions.SSLError(SECRET))

        self.assertEqual(collection.reason_code, "article-date-unavailable")
        self.assertFalse(collection.complete)
        self.assertEqual(collection.articles, ())
        self.assertEqual(get.call_count, 4)
        self.assertEqual(sleep.call_args_list, [call(1), call(2)])
        date = records(logs, DATE_PREFIX)[0]
        self.assertEqual(date["date_resolution"], "detail-request-failed")
        self.assertEqual((date["section"], date["page"], date["article_id"]), ("21", "1", "941143"))
        self.assertEqual(records(logs)[-1]["request_kind"], "article")
        self.assertEqual(records(logs)[-1]["retry_state"], "exhausted")
        summary = records(logs, SUMMARY_PREFIX)[0]
        self.assertEqual(summary["unresolved_date_count"], 1)
        self.assertEqual(summary["unresolved_article_ids_sample"], ["941143"])
        self.assertNotIn(SECRET, "\n".join(logs))

    def test_successful_http_without_date_element_is_identified(self):
        collection, logs, get, sleep = self.collect_date_failure('<html>Article ' + SECRET + '</html>')

        self.assertEqual(get.call_count, 2)
        sleep.assert_not_called()
        self.assertFalse(collection.complete)
        self.assertEqual(records(logs, DATE_PREFIX)[0]["date_resolution"], "date-element-not-found")
        self.assertEqual(records(logs), [])
        self.assertNotIn(SECRET, "\n".join(logs))

    def test_empty_date_element_is_identified(self):
        _collection, logs, get, sleep = self.collect_date_failure('<meta property="article:published_time" content=" ">')

        self.assertEqual(get.call_count, 2)
        sleep.assert_not_called()
        self.assertEqual(records(logs, DATE_PREFIX)[0]["date_resolution"], "date-value-empty")

    def test_invalid_date_value_is_identified_without_logging_raw_value(self):
        _collection, logs, get, sleep = self.collect_date_failure('<time datetime="' + SECRET + '"></time>')

        self.assertEqual(get.call_count, 2)
        sleep.assert_not_called()
        self.assertEqual(records(logs, DATE_PREFIX)[0]["date_resolution"], "date-parse-failed")
        self.assertNotIn(SECRET, "\n".join(logs))

    def test_valid_fallback_after_invalid_metadata_keeps_date_precedence(self):
        html = '<meta property="article:published_time" content="bad"><time datetime="2026-10-08T15:00:00+09:00"></time>'

        resolution = dailymedi._parse_article_date_resolution(html)

        self.assertEqual(resolution.published_at, NOW)
        self.assertIsNone(resolution.reason)
        self.assertEqual(dailymedi.parse_article_page_date(html), NOW)

    def test_unresolved_summary_and_individual_logs_are_bounded(self):
        logs = []

        with patch("builtins.print", side_effect=logs.append):
            page = dailymedi.parse_list_page(
                medibox_html(25), "https://www.dailymedi.com/news/news_list.php?ca_id=21&page=4",
                cutoff=NOW - timedelta(days=7), now=NOW,
                fetch_article_date=lambda _url: dailymedi.DailyMediDateResolution(None, "date-value-empty"),
            )

        self.assertEqual(page.unresolved_date_count, 25)
        self.assertEqual(len(records(logs, DATE_PREFIX)), 20)
        summary = records(logs, SUMMARY_PREFIX)[0]
        self.assertEqual(summary["page"], "4")
        self.assertEqual(summary["unresolved_article_ids_total"], 25)
        self.assertEqual(len(summary["unresolved_article_ids_sample"]), 20)

    def test_section_22_current_time_fallback_is_unchanged_and_visible(self):
        html = '<div class="listNews"><ul class="webzin main2"><li><a href="/news/news_view.php?wr_id=941143"><span class="stitle">Article</span></a></li></ul></div>'
        logs = []

        with patch("builtins.print", side_effect=logs.append):
            page = dailymedi.parse_list_page(
                html, LISTING_URL, cutoff=NOW - timedelta(days=7), now=NOW,
                fetch_article_date=lambda _url: dailymedi.DailyMediDateResolution(None, "detail-request-failed"),
            )

        self.assertEqual(page.articles[0].published_at, NOW)
        self.assertEqual(page.unresolved_date_count, 0)
        self.assertEqual(records(logs, DATE_PREFIX)[0]["fallback"], "current-time")
        self.assertEqual(records(logs, SUMMARY_PREFIX)[0]["current_time_fallback_count"], 1)

    def test_production_entrypoint_uses_date_resolution_diagnostics(self):
        logs = []
        html = medibox_html()
        empty = '<div class="listNews"><ul class="webzin main2"></ul></div>'

        def get(url, **_kwargs):
            if "ca_id=22" in url:
                return response(url, empty)
            if "news_list.php" in url:
                return response(url, html)
            return response(url, '<html>No date</html>')

        with patch.object(dailymedi.requests, "get", side_effect=get), \
            patch("builtins.print", side_effect=logs.append):
            result = dailymedi.fetch_dailymedi_articles()

        self.assertEqual(result.reason_code, "article-date-unavailable")
        self.assertEqual(records(logs, DATE_PREFIX)[0]["date_resolution"], "date-element-not-found")


if __name__ == "__main__":
    unittest.main()
