import ast
from contextlib import redirect_stdout
import io
import json
from pathlib import Path
import ssl
import sys
from types import ModuleType
import unittest
from unittest.mock import Mock, patch

from collector_sources import dailymedi
from collector_failure_diagnostics import ssl_failure_fields
from test_dailymedi_tls_diagnostics import LISTING_URL, records


SECRET = "PRIVATE_COOKIE_TOKEN_DO_NOT_LOG"
PREFIX = "HIRA navigation diagnostic: "


class CollectorFailureDiagnosticsTests(unittest.TestCase):
    def test_non_numeric_ssl_attributes_are_omitted(self):
        # Given an SSL object with untrusted string attributes.
        error = ssl.SSLCertVerificationError(1, SECRET)
        error.errno = SECRET
        error.verify_code = SECRET
        # When diagnostic fields are read.
        result = ssl_failure_fields((error,))
        # Then strings never reach the structured log.
        self.assertEqual(result, {"ssl_errno": None, "ssl_verify_code": None})

    def test_success_has_no_stale_ssl_codes(self):
        # Given a successful retry with no exception chain; when fields are read.
        result = ssl_failure_fields(())
        # Then previous failure codes cannot leak into the success record.
        self.assertEqual(result, {"ssl_errno": None, "ssl_verify_code": None})

    def test_wrapped_tls_failure_records_numeric_code_without_secret(self):
        # Given a real SSL exception wrapped by requests.
        import requests
        error = requests.exceptions.SSLError(SECRET)
        error.__cause__ = ssl.SSLZeroReturnError(6, SECRET)
        logs = []

        # When the existing three-attempt transport path fails.
        with patch.object(dailymedi.requests, "get", side_effect=error) as get, \
                patch.object(dailymedi.time, "sleep") as sleep, \
                patch("builtins.print", side_effect=logs.append):
            with self.assertRaises(requests.exceptions.SSLError) as raised:
                dailymedi._fetch_text(LISTING_URL)

        # Then diagnostic fields preserve the error and transport policy.
        self.assertIs(raised.exception, error)
        self.assertEqual(get.call_count, 3)
        self.assertEqual([call.args for call in sleep.call_args_list], [(1,), (2,)])
        self.assertTrue(all(record["ssl_errno"] == 6 for record in records(logs)))
        self.assertTrue(all(record["ssl_verify_code"] is None for record in records(logs)))
        self.assertNotIn(SECRET, "\n".join(logs))

    def test_certificate_failure_records_verify_code_without_reason_text(self):
        # Given certificate verification data containing sensitive text.
        import requests
        error = requests.exceptions.SSLError(SECRET)
        certificate = ssl.SSLCertVerificationError(1, SECRET)
        certificate.verify_code = 20
        certificate.verify_message = SECRET
        error.__cause__ = certificate
        logs = []

        # When a transport diagnostic is emitted.
        with patch("builtins.print", side_effect=logs.append):
            dailymedi._log_request_diagnostic(dailymedi._request_context(LISTING_URL), 1, 3, "retry", 5, error)

        # Then only numeric verification data is added.
        self.assertEqual(records(logs)[0]["ssl_verify_code"], 20)
        self.assertNotIn(SECRET, logs[0])

    def run_hira_failure(self, observation_error=False, inspection_visible=False):
        # Isolate the real function: importing collector.py would create a DB client.
        tree = ast.parse((Path(__file__).parents[1] / "collector.py").read_text())
        function = next(node for node in tree.body if isinstance(node, ast.FunctionDef) and node.name == "fetch_hira_biz_notices")
        class BrowserError(Exception):
            pass
        click_error = BrowserError("blocked " + SECRET)
        page = Mock()
        page.locator.return_value.is_visible.return_value = inspection_visible
        page.get_by_text.return_value.first.click.side_effect = click_error
        state = {"ready_state": "complete", "body_text_length": 123,
                 "inspection_element_count": 4, "visible_inspection_element_count": 2}
        page.evaluate.return_value = state
        if observation_error:
            page.evaluate.side_effect = BrowserError(SECRET)
        browser = Mock()
        browser.new_page.return_value = page
        runtime = Mock()
        runtime.chromium.launch.return_value = browser
        manager = Mock()
        manager.__enter__ = Mock(return_value=runtime)
        manager.__exit__ = Mock(return_value=False)
        module = ModuleType("playwright.sync_api")
        module.sync_playwright = lambda: manager
        module.Error = BrowserError
        namespace = {"_goto_until_ready": Mock(), "_wait_for_target_response": Mock()}
        from collector_failure_diagnostics import hira_failure_fields
        namespace["hira_failure_fields"] = hira_failure_fields
        exec(compile(ast.Module(body=[function], type_ignores=[]), "isolated-hira", "exec"), namespace)
        output = io.StringIO()
        with patch.dict(sys.modules, {"playwright": ModuleType("playwright"), "playwright.sync_api": module}), redirect_stdout(output):
            with self.assertRaises(RuntimeError) as raised:
                namespace["fetch_hira_biz_notices"]()
        diagnostic = next(line[len(PREFIX):] for line in output.getvalue().splitlines() if line.startswith(PREFIX))
        return page, click_error, raised.exception, json.loads(diagnostic), diagnostic

    def test_hira_click_failure_logs_bounded_state_and_keeps_original_cause(self):
        # Given a failed normal click; when the real function handles it.
        page, cause, error, record, encoded = self.run_hira_failure()
        # Then there is no second click or recovery action.
        page.get_by_text.return_value.first.click.assert_called_once_with()
        page.evaluate.assert_called_once()
        self.assertIs(error.__cause__, cause)
        self.assertEqual(record["stage"], "auto_insurance_click")
        self.assertEqual(record["visible_inspection_element_count"], 2)
        self.assertEqual(record["exception_type"], "BrowserError")
        self.assertNotIn(SECRET, encoded)

    def test_hira_observation_failure_does_not_replace_click_failure(self):
        # Given a closed/unavailable page; when diagnostic observation fails.
        _page, cause, error, record, encoded = self.run_hira_failure(observation_error=True)
        # Then the original failure propagates and the observation failure is visible.
        self.assertIs(error.__cause__, cause)
        self.assertEqual(record["observation_error_type"], "BrowserError")
        self.assertNotIn(SECRET, encoded)

    def test_hira_inspection_notice_is_closed_before_board_navigation(self):
        page, _cause, _error, _record, _encoded = self.run_hira_failure(inspection_visible=True)
        notice = page.locator.return_value
        notice.locator.assert_called_once_with('[id$="_form_btn_close"]')
        notice.locator.return_value.click.assert_called_once_with(timeout=5000)
        notice.wait_for.assert_called_once_with(state="hidden", timeout=5000)
        calls = [str(item) for item in page.mock_calls]
        self.assertLess(calls.index("call.locator().wait_for(state='hidden', timeout=5000)"),
                        calls.index("call.get_by_text('자보알림방', exact=True)"))

    def test_hira_absent_inspection_notice_is_not_clicked(self):
        page, _cause, _error, _record, _encoded = self.run_hira_failure()
        page.locator.return_value.locator.assert_not_called()
        page.locator.return_value.wait_for.assert_not_called()
