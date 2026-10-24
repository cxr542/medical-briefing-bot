from dataclasses import asdict
from contextlib import redirect_stdout
import io
import json
import os
from pathlib import Path
import subprocess
from typing import Callable
import unittest
from unittest.mock import Mock, patch

import requests

import transport_diagnostics as diagnostic


class TransportDiagnosticTests(unittest.TestCase):
    def test_requests_verifies_tls_disables_environment_credentials_and_reads_body(self) -> None:
        response = Mock(status_code=200)
        response.iter_content.return_value = [b"public response"]
        session = Mock()
        session.get.return_value.__enter__ = Mock(return_value=response)
        session.get.return_value.__exit__ = Mock(return_value=False)
        with patch.object(diagnostic.requests, "Session") as factory:
            factory.return_value.__enter__.return_value = session
            result = diagnostic.requests_probe(diagnostic.ENDPOINTS[0])
        self.assertEqual(result.http_status, 200)
        self.assertIsNone(result.error_code)
        self.assertFalse(session.trust_env)
        self.assertEqual(session.max_redirects, 5)
        self.assertEqual(session.get.call_args.kwargs["timeout"], (5, 20))
        self.assertIs(session.get.call_args.kwargs["verify"], True)
        response.iter_content.assert_called_once_with(65536)

    def test_requests_exception_messages_and_urls_are_never_emitted(self) -> None:
        for exception in (requests.ConnectTimeout, requests.ReadTimeout, requests.exceptions.SSLError):
            with self.subTest(exception=exception.__name__), patch.object(diagnostic.requests, "Session") as factory:
                factory.return_value.__enter__.return_value.get.side_effect = exception("SECRET_RAW_ERROR_URL")
                result = diagnostic.requests_probe(diagnostic.ENDPOINTS[0])
            self.assertEqual(result.error_code, exception.__name__)
            self.assertIsNone(result.http_status)
            self.assertNotIn("SECRET", json.dumps(asdict(result)))

    def test_requests_body_and_redirect_failures_remain_failures(self) -> None:
        response = Mock(status_code=200)
        response.iter_content.return_value = [b"x" * 1048577]
        with patch.object(diagnostic.requests, "Session") as factory:
            session = factory.return_value.__enter__.return_value
            session.get.return_value.__enter__.return_value = response
            self.assertEqual(diagnostic.requests_probe(diagnostic.ENDPOINTS[0]).error_code, "body_limit")
            session.get.side_effect = requests.TooManyRedirects("SECRET")
            self.assertEqual(diagnostic.requests_probe(diagnostic.ENDPOINTS[0]).error_code, "TooManyRedirects")

    def test_curl_uses_same_ua_verified_tls_bounded_request_and_safe_environment(self) -> None:
        completed = subprocess.CompletedProcess([], 0, "200|0.2|0.4", "SECRET")
        with patch.dict(os.environ, {"HTTP_PROXY": "SECRET", "HOME": "/private/home", "TOKEN": "SECRET"}), \
                patch.object(diagnostic.subprocess, "run", return_value=completed) as run:
            result = diagnostic.curl_probe(diagnostic.ENDPOINTS[0])
        self.assertEqual((result.http_status, result.connect_ms, result.appconnect_ms), (200, 200, 400))
        command = run.call_args.args[0]
        self.assertEqual(command[:2], ["curl", "--disable"])
        self.assertIn(diagnostic.USER_AGENT, command)
        self.assertNotIn("--insecure", command)
        self.assertNotIn("--netrc", command)
        self.assertNotIn("--retry", command)
        self.assertEqual(run.call_args.kwargs["timeout"], 30)
        self.assertLessEqual(set(run.call_args.kwargs["env"]), {"PATH", "SYSTEMROOT"})

    def test_curl_errors_nonfinite_metrics_and_process_failures_are_sanitized(self) -> None:
        cases = [(28, "SECRET", "curl_exit_28"), (35, "SECRET", "curl_exit_35"),
                 (0, "SECRET", "invalid_metrics"), (0, "000|0|0", "invalid_metrics"),
                 (0, "200|nan|0", "invalid_metrics"), (0, "200|0|inf", "invalid_metrics")]
        for code, stdout, expected in cases:
            with self.subTest(expected=expected), patch.object(diagnostic.subprocess, "run",
                    return_value=subprocess.CompletedProcess([], code, stdout, "SECRET")):
                result = diagnostic.curl_probe(diagnostic.ENDPOINTS[0])
            self.assertEqual(result.error_code, expected)
            self.assertNotIn("SECRET", json.dumps(asdict(result)))
        for error, expected in [(subprocess.TimeoutExpired("SECRET", 30), "process_timeout"),
                                (FileNotFoundError("SECRET"), "process_unavailable")]:
            with patch.object(diagnostic.subprocess, "run", side_effect=error):
                self.assertEqual(diagnostic.curl_probe(diagnostic.ENDPOINTS[0]).error_code, expected)

    def test_main_compares_two_rounds_reverses_order_and_fails_for_bad_outcomes(self) -> None:
        order = []
        def probe(client: str) -> Callable[[diagnostic.Endpoint], diagnostic.Probe]:
            def execute(endpoint: diagnostic.Endpoint) -> diagnostic.Probe:
                order.append(client)
                return diagnostic.Probe(client, 403 if client == "curl" else 200, 1)
            return execute
        output = io.StringIO()
        with patch.object(diagnostic, "ENDPOINTS", diagnostic.ENDPOINTS[:1]), \
                patch.object(diagnostic, "requests_probe", side_effect=probe("requests")), \
                patch.object(diagnostic, "curl_probe", side_effect=probe("curl")), redirect_stdout(output):
            self.assertEqual(diagnostic.main(), 1)
        self.assertEqual(order, ["requests", "curl", "curl", "requests"])
        rows = [json.loads(line) for line in output.getvalue().splitlines()]
        self.assertEqual(rows[-1], {"kind": "summary", "probes": 4, "failed_or_non_200": 2})
        self.assertFalse(any("url" in row for row in rows))

    def test_workflow_is_manual_only_and_has_no_secret_or_db_connection(self) -> None:
        workflow = (Path(__file__).parents[2] / ".github/workflows/collector_transport_diagnostics.yml").read_text()
        self.assertIn("workflow_dispatch:", workflow)
        for forbidden in ("schedule:", "push:", "secrets.", "SUPABASE", "collector.py", "continue-on-error"):
            self.assertNotIn(forbidden, workflow)
        self.assertIn("requests==2.32.5 urllib3==2.6.3", workflow)
