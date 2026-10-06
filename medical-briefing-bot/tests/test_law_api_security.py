import ast
import os
from pathlib import Path
import sys
import unittest
from unittest.mock import Mock, patch

import requests
import supabase


PACKAGE_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(PACKAGE_ROOT))

with patch.object(supabase, "create_client", return_value=Mock()):
    import collector


FAKE_CREDENTIAL = "fake-law-credential-for-offline-tests"


def response(status_code, payload=None, json_error=None):
    result = Mock()
    result.status_code = status_code
    if json_error is not None:
        result.json.side_effect = json_error
    else:
        result.json.return_value = payload
    return result


class LawApiSecurityTests(unittest.TestCase):
    def test_missing_key_fails_closed_without_request(self):
        with patch.dict(os.environ, {}, clear=False):
            os.environ.pop("LAW_API_KEY", None)
            with patch.object(collector, "get_with_transient_retry") as request:
                with self.assertRaises(collector.LawApiError):
                    collector.fetch_law_api()
        request.assert_not_called()

    def test_empty_key_fails_closed_without_request(self):
        with patch.dict(os.environ, {"LAW_API_KEY": ""}):
            with patch.object(collector, "get_with_transient_retry") as request:
                with self.assertRaises(collector.LawApiError):
                    collector.fetch_law_api()
        request.assert_not_called()

    def test_whitespace_key_fails_closed_without_request(self):
        with patch.dict(os.environ, {"LAW_API_KEY": " \t\n"}):
            with patch.object(collector, "get_with_transient_retry") as request:
                with self.assertRaises(collector.LawApiError):
                    collector.fetch_law_api()
        request.assert_not_called()

    def test_valid_key_and_response_preserve_normal_parsing(self):
        payload = {
            "LawSearch": {
                "law": [
                    {"법령명한글": "의료법", "법령일련번호": "12345"},
                    {"법령명한글": "의료법 시행령", "법령일련번호": "67890"},
                ]
            }
        }
        with patch.dict(os.environ, {"LAW_API_KEY": FAKE_CREDENTIAL}):
            with patch.object(
                collector,
                "get_with_transient_retry",
                return_value=response(200, payload),
            ) as request:
                articles = collector.fetch_law_api()

        self.assertEqual(len(articles), 2)
        self.assertEqual(articles[0]["title"], "[법령] 의료법")
        self.assertEqual(
            articles[0]["url"],
            "https://www.law.go.kr/LSW/lsInfoP.do?lsiSeq=12345",
        )
        self.assertEqual(request.call_args.args[0], "https://www.law.go.kr/DRF/lawSearch.do")
        self.assertEqual(request.call_args.kwargs["params"]["OC"], FAKE_CREDENTIAL)
        self.assertNotIn(FAKE_CREDENTIAL, request.call_args.args[0])

    def test_retry_helper_passes_law_parameters_to_requests(self):
        url = "https://www.law.go.kr/DRF/lawSearch.do"
        params = {"OC": FAKE_CREDENTIAL, "target": "law"}
        with patch.object(collector.requests, "get", return_value=Mock()) as request:
            collector.get_with_transient_retry(
                url,
                source_name="LAW",
                timeout=10,
                params=params,
            )

        request.assert_called_once_with(
            url,
            params=params,
            headers=None,
            timeout=10,
            verify=True,
            allow_redirects=True,
        )

    def test_retry_helper_preserves_non_law_request_arguments(self):
        url = "https://example.test/feed.xml"
        with patch.object(collector.requests, "get", return_value=Mock()) as request:
            collector.get_with_transient_retry(
                url,
                source_name="RSS",
                timeout=20,
            )

        request.assert_called_once_with(
            url,
            headers=None,
            timeout=20,
            verify=True,
            allow_redirects=True,
        )

    def test_valid_empty_collection_returns_zero_articles(self):
        with patch.dict(os.environ, {"LAW_API_KEY": FAKE_CREDENTIAL}):
            with patch.object(
                collector,
                "get_with_transient_retry",
                return_value=response(200, {"LawSearch": {"law": []}}),
            ):
                self.assertEqual(collector.fetch_law_api(), [])

    def test_error_metadata_in_law_response_fails_closed_even_when_collection_empty(self):
        payload = {
            "LawSearch": {
                "error": "authentication failed",
                "law": [],
            }
        }
        with patch.dict(os.environ, {"LAW_API_KEY": FAKE_CREDENTIAL}):
            with patch.object(
                collector,
                "get_with_transient_retry",
                return_value=response(200, payload),
            ):
                with self.assertRaises(collector.LawApiError):
                    collector.fetch_law_api()

    def test_http_authentication_failure_creates_no_article(self):
        with patch.dict(os.environ, {"LAW_API_KEY": FAKE_CREDENTIAL}):
            with patch.object(
                collector,
                "get_with_transient_retry",
                return_value=response(401, {"error": "unauthorized"}),
            ):
                with self.assertRaisesRegex(collector.LawApiError, "401"):
                    collector.fetch_law_api()

    def test_http_200_error_payload_fails_closed(self):
        payload = {"error": {"message": f"rejected {FAKE_CREDENTIAL}"}}
        with patch.dict(os.environ, {"LAW_API_KEY": FAKE_CREDENTIAL}):
            with patch.object(
                collector,
                "get_with_transient_retry",
                return_value=response(200, payload),
            ):
                with self.assertRaises(collector.LawApiError) as raised:
                    collector.fetch_law_api()

        self.assertNotIn(FAKE_CREDENTIAL, str(raised.exception))

    def test_unexpected_json_fails_closed(self):
        with patch.dict(os.environ, {"LAW_API_KEY": FAKE_CREDENTIAL}):
            with patch.object(
                collector,
                "get_with_transient_retry",
                return_value=response(200, {"unexpected": []}),
            ):
                with self.assertRaises(collector.LawApiError):
                    collector.fetch_law_api()

    def test_malformed_json_fails_closed_without_echoing_error(self):
        with patch.dict(os.environ, {"LAW_API_KEY": FAKE_CREDENTIAL}):
            with patch.object(
                collector,
                "get_with_transient_retry",
                return_value=response(
                    200, json_error=ValueError(f"malformed {FAKE_CREDENTIAL}")
                ),
            ):
                with self.assertRaises(collector.LawApiError) as raised:
                    collector.fetch_law_api()

        self.assertNotIn(FAKE_CREDENTIAL, str(raised.exception))

    def test_request_exception_url_is_not_logged_or_returned(self):
        error = requests.exceptions.ConnectionError(
            f"failed https://www.law.go.kr/DRF/lawSearch.do?OC={FAKE_CREDENTIAL}"
        )
        with patch.dict(os.environ, {"LAW_API_KEY": FAKE_CREDENTIAL}):
            with patch.object(
                collector, "get_with_transient_retry", side_effect=error
            ):
                with patch("builtins.print") as output:
                    with self.assertRaises(collector.LawApiError) as raised:
                        collector.fetch_law_api()

        self.assertNotIn(FAKE_CREDENTIAL, str(raised.exception))
        self.assertNotIn(FAKE_CREDENTIAL, str(output.call_args_list))

    def test_timeout_and_connection_errors_are_sanitized(self):
        errors = [
            requests.exceptions.Timeout(f"timeout OC={FAKE_CREDENTIAL}"),
            requests.exceptions.ConnectionError(f"reset OC={FAKE_CREDENTIAL}"),
        ]
        for error in errors:
            with self.subTest(error_type=type(error).__name__):
                with patch.dict(os.environ, {"LAW_API_KEY": FAKE_CREDENTIAL}):
                    with patch.object(
                        collector, "get_with_transient_retry", side_effect=error
                    ):
                        with self.assertRaises(collector.LawApiError) as raised:
                            collector.fetch_law_api()
                self.assertNotIn(FAKE_CREDENTIAL, str(raised.exception))

    def test_invalid_law_record_fails_closed(self):
        payload = {"LawSearch": {"law": [{"법령일련번호": "12345"}]}}
        with patch.dict(os.environ, {"LAW_API_KEY": FAKE_CREDENTIAL}):
            with patch.object(
                collector,
                "get_with_transient_retry",
                return_value=response(200, payload),
            ):
                with self.assertRaises(collector.LawApiError):
                    collector.fetch_law_api()

    def test_frontend_has_no_law_api_key_reference(self):
        frontend = PACKAGE_ROOT / "frontend"
        source_files = (
            path for path in frontend.rglob("*")
            if path.is_file() and path.suffix in {".js", ".jsx", ".ts", ".tsx"}
        )
        self.assertFalse(
            any("LAW_API_KEY" in path.read_text(encoding="utf-8") for path in source_files)
        )

    def test_law_key_lookup_has_no_hardcoded_default(self):
        tree = ast.parse(Path(collector.__file__).read_text(encoding="utf-8"))
        defaults = [
            node
            for node in ast.walk(tree)
            if isinstance(node, ast.Call)
            and isinstance(node.func, ast.Attribute)
            and node.func.attr == "get"
            and isinstance(node.func.value, ast.Attribute)
            and node.func.value.attr == "environ"
            and node.args
            and isinstance(node.args[0], ast.Constant)
            and node.args[0].value == "LAW_API_KEY"
        ]
        self.assertEqual(len(defaults), 1)
        self.assertEqual(len(defaults[0].args), 1)
        self.assertFalse(defaults[0].keywords)


if __name__ == "__main__":
    unittest.main()
