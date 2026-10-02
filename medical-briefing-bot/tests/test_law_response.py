import ast
from datetime import datetime, timezone
from pathlib import Path
import unittest
from unittest.mock import Mock

from collector_parsers import get_content_hash


class LawResponseTests(unittest.TestCase):
    def fetch(self, payload):
        tree = ast.parse((Path(__file__).parents[1] / "collector.py").read_text())
        function = next(node for node in tree.body if isinstance(node, ast.FunctionDef) and node.name == "fetch_law_api")
        response = Mock(status_code=200)
        response.json.return_value = payload
        namespace = {
            "datetime": datetime,
            "timezone": timezone,
            "law_api_key": "test-only-identifier",
            "get_content_hash": get_content_hash,
            "get_with_transient_retry": lambda *args, **kwargs: response,
        }
        exec(compile(ast.Module(body=[function], type_ignores=[]), "isolated-law-response", "exec"), namespace)
        return namespace["fetch_law_api"]()

    def test_authentication_error_json_never_becomes_a_fabricated_article(self):
        with self.assertRaisesRegex(ValueError, "LawSearch"):
            self.fetch({"error": "invalid authentication"})

    def test_valid_law_response_keeps_upstream_article(self):
        articles = self.fetch({"LawSearch": {"law": [{"법령명한글": "의료법", "법령일련번호": "123"}]}})
        self.assertEqual(len(articles), 1)
        self.assertEqual(articles[0]["title"], "[법령] 의료법")
        self.assertTrue(articles[0]["url"].endswith("lsiSeq=123"))

    def test_valid_empty_law_list_remains_empty(self):
        self.assertEqual(self.fetch({"LawSearch": {"law": []}}), [])
