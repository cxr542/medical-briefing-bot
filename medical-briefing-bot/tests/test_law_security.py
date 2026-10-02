import ast
import contextlib
from datetime import datetime, timezone
import io
import os
from pathlib import Path
import runpy
import subprocess
import sys
import time
import traceback
from types import SimpleNamespace
import unittest
from unittest.mock import Mock, patch
from urllib.parse import parse_qs, urlparse

import requests

from collector_parsers import get_content_hash
from law_api_security import (
    LawAPIError,
    LawConfigurationError,
    build_law_api_url,
    require_law_api_key,
)


ROOT = Path(__file__).parents[1]
TEST_CREDENTIAL = "test-only-not-a-production-credential"


def law_collector():
    tree = ast.parse((ROOT / "collector.py").read_text())
    functions = [
        node for node in tree.body
        if isinstance(node, ast.FunctionDef)
        and node.name in ("fetch_law_api", "get_with_transient_retry")
    ]
    namespace = {
        "datetime": datetime,
        "timezone": timezone,
        "get_content_hash": get_content_hash,
        "requests": requests,
        "time": SimpleNamespace(sleep=lambda delay: None),
        "require_law_api_key": require_law_api_key,
        "build_law_api_url": build_law_api_url,
        "LawAPIError": LawAPIError,
    }
    exec(compile(ast.Module(body=functions, type_ignores=[]), "isolated-law-collector", "exec"), namespace)
    return namespace["fetch_law_api"]


class LawSecurityTests(unittest.TestCase):
    def setUp(self):
        self.environment = patch.dict(os.environ, {"LAW_API_KEY": TEST_CREDENTIAL}, clear=True)
        self.environment.start()
        self.addCleanup(self.environment.stop)
        self.collector = law_collector()

    def test_environment_credential_is_used_in_actual_request(self):
        response = Mock(status_code=200)
        response.json.return_value = {"LawSearch": {"law": [{"법령명한글": "의료법", "법령일련번호": "123"}]}}
        with patch.object(requests, "get", return_value=response) as request:
            articles = self.collector()
        self.assertEqual(parse_qs(urlparse(request.call_args.args[0]).query)["OC"], [TEST_CREDENTIAL])
        self.assertEqual(len(articles), 1)
        self.assertTrue(articles[0]["url"].endswith("lsiSeq=123"))

    def test_missing_credential_fails_before_any_request(self):
        with patch.dict(os.environ, {}, clear=True), patch.object(requests, "get") as request:
            with self.assertRaises(LawConfigurationError) as error:
                self.collector()
        self.assertIn("LAW_API_KEY", str(error.exception))
        request.assert_not_called()

    def test_blank_credential_is_a_configuration_failure(self):
        with patch.dict(os.environ, {"LAW_API_KEY": "   "}):
            with self.assertRaises(LawConfigurationError):
                require_law_api_key()

    def test_query_delimiters_in_credential_are_encoded(self):
        credential = "test-only&target=unexpected+value"
        query = parse_qs(urlparse(build_law_api_url(credential)).query)
        self.assertEqual(query["OC"], [credential])
        self.assertEqual(query["target"], ["law"])

    def test_empty_successful_law_list_stays_empty(self):
        response = Mock(status_code=200)
        response.json.return_value = {"LawSearch": {"law": []}}
        with patch.object(requests, "get", return_value=response):
            self.assertEqual(self.collector(), [])

    def test_authentication_error_payloads_never_become_articles_or_logs(self):
        for payload in (
            {"error": TEST_CREDENTIAL},
            {"Response": {"result": TEST_CREDENTIAL}},
            {"resultCode": "AUTH_FAILED", "msg": TEST_CREDENTIAL},
            {"LawSearch": {"error": TEST_CREDENTIAL}},
        ):
            with self.subTest(payload_type=next(iter(payload))):
                response = Mock(status_code=200)
                response.json.return_value = payload
                output = io.StringIO()
                with patch.object(requests, "get", return_value=response), contextlib.redirect_stdout(output):
                    with self.assertRaises(LawAPIError) as error:
                        self.collector()
                self.assertNotIn(TEST_CREDENTIAL, output.getvalue() + str(error.exception))
                self.assertEqual(error.exception.failure_type, "authentication_response")

    def test_request_exception_url_is_not_in_errors_or_tracebacks(self):
        output = io.StringIO()
        captured_traceback = ""
        failure = requests.ConnectionError(build_law_api_url(TEST_CREDENTIAL))
        with patch.object(requests, "get", side_effect=failure) as request, patch.object(time, "sleep"), contextlib.redirect_stdout(output):
            try:
                self.collector()
            except LawAPIError:
                captured_traceback = traceback.format_exc()
        self.assertEqual(request.call_count, 4)
        self.assertIn("LAW API request failed", captured_traceback)
        self.assertNotIn(TEST_CREDENTIAL, output.getvalue() + captured_traceback)
        self.assertNotIn("OC=", output.getvalue() + captured_traceback)

    def test_http_error_does_not_decode_or_dump_body(self):
        response = Mock(status_code=401)
        response.text = TEST_CREDENTIAL
        with patch.object(requests, "get", return_value=response):
            with self.assertRaises(LawAPIError):
                self.collector()
        response.json.assert_not_called()

    def test_json_decoder_exception_is_sanitized(self):
        response = Mock(status_code=200)
        response.json.side_effect = ValueError(TEST_CREDENTIAL)
        output = io.StringIO()
        with patch.object(requests, "get", return_value=response), contextlib.redirect_stdout(output):
            with self.assertRaises(LawAPIError) as error:
                self.collector()
        self.assertNotIn(TEST_CREDENTIAL, output.getvalue() + str(error.exception))

    def test_probe_uses_environment_and_never_dumps_response(self):
        response = Mock(status_code=200, text=TEST_CREDENTIAL)
        output = io.StringIO()
        with patch.object(requests, "get", return_value=response) as request, contextlib.redirect_stdout(output):
            runpy.run_path(str(ROOT / "test_law_api.py"), run_name="__main__")
        self.assertEqual(parse_qs(urlparse(request.call_args.args[0]).query)["OC"], [TEST_CREDENTIAL])
        self.assertNotIn(TEST_CREDENTIAL, output.getvalue())
        self.assertIn("200", output.getvalue())

    def test_probe_missing_environment_fails_without_network(self):
        with patch.dict(os.environ, {}, clear=True), patch.object(requests, "get") as request:
            with self.assertRaises(LawConfigurationError):
                runpy.run_path(str(ROOT / "test_law_api.py"), run_name="__main__")
        request.assert_not_called()

    def test_probe_request_error_is_sanitized(self):
        with patch.object(requests, "get", side_effect=requests.RequestException(TEST_CREDENTIAL)):
            with self.assertRaises(LawAPIError) as error:
                runpy.run_path(str(ROOT / "test_law_api.py"), run_name="__main__")
        self.assertNotIn(TEST_CREDENTIAL, str(error.exception))

    def test_probe_cli_reports_missing_configuration(self):
        environment = {name: value for name, value in os.environ.items() if name != "LAW_API_KEY"}
        result = subprocess.run(
            [sys.executable, str(ROOT / "test_law_api.py")],
            capture_output=True, text=True, env=environment, timeout=10,
        )
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("LawConfigurationError", result.stderr)
        self.assertIn("LAW_API_KEY", result.stderr)

    def test_tracked_python_tree_has_no_literal_law_credential_default(self):
        for path in ROOT.rglob("*.py"):
            tree = ast.parse(path.read_text())
            for node in ast.walk(tree):
                if isinstance(node, ast.Call) and isinstance(node.func, ast.Attribute) and node.func.attr == "get" and node.args and isinstance(node.args[0], ast.Constant) and node.args[0].value == "LAW_API_KEY":
                    defaults = list(node.args[1:]) + [keyword.value for keyword in node.keywords if keyword.arg == "default"]
                    self.assertTrue(all(isinstance(default, ast.Constant) and default.value in ("", None) for default in defaults), str(path.relative_to(ROOT)))
