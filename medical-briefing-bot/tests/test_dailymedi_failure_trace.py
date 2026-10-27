import json
import ssl
from types import FunctionType
import unittest
from unittest.mock import patch

import requests
import urllib3

from collector_failure_diagnostics import failure_trace_fields
from collector_sources import dailymedi
from test_dailymedi_tls_diagnostics import LISTING_URL, records, response


SECRET = "TOKEN_COOKIE_BODY_PATH_MUST_NOT_APPEAR"


def _raise_failure() -> None:
    raise ssl.SSLZeroReturnError(6, SECRET)


def frame_error(module: str, name: str) -> ssl.SSLZeroReturnError:
    """Create a real traceback with controlled frame identity, without networking."""
    function = FunctionType(
        _raise_failure.__code__.replace(co_name=name, co_filename=SECRET),
        {"__name__": module, "ssl": ssl, "SECRET": SECRET},
    )
    try:
        function()
    except ssl.SSLZeroReturnError as error:
        return error
    raise AssertionError(SECRET)


class DailyMediFailureTraceTests(unittest.TestCase):
    def test_known_frames_emit_only_coarse_presence_flags(self) -> None:
        cases = (
            ("ssl", "do_handshake", "trace_tls_handshake"),
            ("http.client", "_read_status", "trace_http_headers"),
            ("http.client", "read", "trace_http_body"),
            ("urllib3.response", "_raw_read", "trace_http_body"),
        )
        for module, name, expected in cases:
            with self.subTest(module=module, name=name):
                fields = failure_trace_fields((frame_error(module, name),))
                self.assertEqual({key for key, value in fields.items() if value}, {expected})
                self.assertNotIn(SECRET, json.dumps(fields))

    def test_unknown_frames_and_missing_traceback_are_not_classified(self) -> None:
        for error in (RuntimeError(SECRET), frame_error("private.module", "read"),
                      frame_error("ssl", "unrecognized")):
            self.assertFalse(any(failure_trace_fields((error,)).values()))

    def test_wrapped_and_overlapping_evidence_is_preserved_without_phase_guess(self) -> None:
        handshake = frame_error("ssl", "do_handshake")
        header = frame_error("http.client", "begin")
        body = frame_error("urllib3.response", "read")
        handshake.__context__ = header
        header.__cause__ = body
        wrapped = requests.exceptions.SSLError(
            urllib3.exceptions.MaxRetryError(None, SECRET, urllib3.exceptions.SSLError(handshake))
        )
        fields = failure_trace_fields(dailymedi._exception_chain(wrapped))
        self.assertEqual(fields, {
            "trace_tls_handshake": True, "trace_http_headers": True,
            "trace_http_body": True, "trace_truncated": False,
        })
        self.assertNotIn(SECRET, json.dumps(fields))

    def test_cycles_and_chain_limit_remain_bounded(self) -> None:
        error = frame_error("ssl", "do_handshake")
        error.__cause__ = error
        fields = failure_trace_fields(dailymedi._exception_chain(error))
        self.assertTrue(fields["trace_tls_handshake"])
        self.assertFalse(fields["trace_truncated"])
        self.assertTrue(failure_trace_fields((error,) * 16)["trace_truncated"])
        self.assertFalse(failure_trace_fields((RuntimeError(SECRET),) * 16 + (error,))["trace_tls_handshake"])

    def test_long_trace_is_bounded_and_explicitly_marked(self) -> None:
        def recurse(depth: int) -> None:
            if depth:
                recurse(depth - 1)
            else:
                _raise_failure()

        try:
            recurse(80)
        except ssl.SSLZeroReturnError as error:
            fields = failure_trace_fields((error,))
        self.assertTrue(fields["trace_truncated"])
        self.assertFalse(fields["trace_tls_handshake"])

    def test_failure_and_recovery_preserve_get_options_and_log_fields(self) -> None:
        inner = frame_error("ssl", "do_handshake")
        error = requests.exceptions.SSLError(inner)
        logs = []
        with patch.object(dailymedi.requests, "get", side_effect=[error, response(LISTING_URL, "ok")]) as get, \
                patch.object(dailymedi.time, "sleep") as sleep, \
                patch("builtins.print", side_effect=logs.append):
            self.assertEqual(dailymedi._fetch_text(LISTING_URL), "ok")
        self.assertEqual(get.call_count, 2)
        sleep.assert_called_once_with(1)
        self.assertEqual(get.call_args_list[0], get.call_args_list[1])
        self.assertEqual(get.call_args.kwargs, {
            "headers": {"User-Agent": "Mozilla/5.0 (compatible; MedicalBriefingBot/1.0)"},
            "timeout": (5, 20), "allow_redirects": True,
        })
        logged = records(logs)
        self.assertTrue(logged[0]["trace_tls_handshake"])
        self.assertEqual(logged[0]["ssl_errno"], 6)
        self.assertNotIn("trace_tls_handshake", logged[1])
        self.assertNotIn(SECRET, "\n".join(logs))

    def test_first_attempt_success_adds_no_request_trace_log(self) -> None:
        logs = []
        with patch.object(dailymedi.requests, "get", return_value=response(LISTING_URL, "ok")), \
                patch("builtins.print", side_effect=logs.append):
            dailymedi._fetch_text(LISTING_URL)
        self.assertEqual(records(logs), [])
