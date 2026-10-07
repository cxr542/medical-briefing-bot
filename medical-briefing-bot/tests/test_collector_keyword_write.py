import ast
import copy
from pathlib import Path
from types import SimpleNamespace
import unittest

from collector_keyword_enrichment import SavedArticle, enrich_saved_article
from collector_keyword_boundary import KeywordBoundaryClient
from keyword_boundary_contract import Metadata


class Boundary:
    def __init__(self):
        self.calls = 0
        self.closed = False

    def analyze_title(self, title):
        self.calls += 1
        return {"format_version": "kiwi-title-boundary-v1", "processor_version": "kiwipiepy-0.24.0-cong-boundary-v1",
                "input_title": title, "decisions": [{"original": title, "decision": "KEEP", "normalized": title}]}

    def close(self):
        self.closed = True


class Store:
    def __init__(self, stored, metadata_failure=False, save_failure=False):
        self.stored = copy.deepcopy(stored)
        self.metadata_failure = metadata_failure
        self.save_failure = save_failure
        self.upserts = []
        self.updates = []
        self.filters = []
        self.operation = None

    def table(self, name):
        assert name == "articles"
        return self

    def upsert(self, article, on_conflict):
        assert on_conflict == "url"
        self.upserts.append(copy.deepcopy(article))
        self.operation = "upsert"
        self.payload = article
        return self

    def update(self, payload):
        self.updates.append(copy.deepcopy(payload))
        self.operation = "update"
        self.payload = payload
        self.filters = []
        return self

    def eq(self, key, value):
        self.filters.append((key, value))
        return self

    def execute(self):
        if self.operation == "upsert":
            if self.save_failure:
                raise ValueError("save unavailable")
            self.stored.update(self.payload)
        else:
            if self.metadata_failure:
                raise ValueError("column unavailable")
            if all(self.stored.get(k) == v for k, v in self.filters):
                self.stored.update(self.payload)
        return SimpleNamespace(data=[copy.deepcopy(self.stored)])


def load_save_functions(store, boundary):
    source = Path(__file__).parents[1] / "collector.py"
    tree = ast.parse(source.read_text())
    functions = [n for n in tree.body if isinstance(n, ast.FunctionDef)
                 and n.name in ("save_keyword_boundary", "save_to_supabase")]
    namespace = {"supabase": store, "KeywordBoundaryClient": lambda: boundary,
                 "enrich_saved_article": enrich_saved_article, "APIError": ValueError, "HTTPError": OSError,
                 "SavedArticle": SavedArticle, "Metadata": Metadata}
    exec(compile(ast.Module(body=functions, type_ignores=[]), str(source), "exec"), namespace)
    return namespace["save_to_supabase"]


class WriteBoundaryTests(unittest.TestCase):
    def record(self, keywords):
        return {"title": "환자안전", "url": "https://example.test/article", "status": "NEW", "keywords": keywords}

    def test_metadata_write_contains_only_derived_field_and_preserves_original(self):
        article = self.record(None)
        original = copy.deepcopy(article)
        store, boundary = Store(article), Boundary()
        result = load_save_functions(store, boundary)([article])
        self.assertEqual(result, {"attempted": 1, "succeeded": 1, "failed": 0})
        self.assertEqual(list(store.updates[0]), ["keyword_boundary"])
        self.assertEqual(store.filters, [("url", article["url"]), ("title", article["title"])])
        self.assertEqual(store.stored["keywords"], None)
        self.assertEqual(article, original)
        self.assertTrue(boundary.closed)

    def test_optional_metadata_error_does_not_change_primary_save_success(self):
        article = self.record(None)
        store, boundary = Store(article, metadata_failure=True), Boundary()
        result = load_save_functions(store, boundary)([article])
        self.assertEqual(result, {"attempted": 1, "succeeded": 1, "failed": 0})
        self.assertEqual(store.stored, article)
        self.assertTrue(boundary.closed)

    def test_primary_save_failure_does_not_trigger_optional_analysis(self):
        article = self.record(None)
        store, boundary = Store(article, save_failure=True), Boundary()
        result = load_save_functions(store, boundary)([article])
        self.assertEqual(result, {"attempted": 1, "succeeded": 0, "failed": 1})
        self.assertEqual(boundary.calls, 0)

    def test_unavailable_subprocess_keeps_collector_saves_successful(self):
        article = self.record(None)
        store = Store(article)
        boundary = KeywordBoundaryClient(["nonexistent-keyword-child"])
        self.addCleanup(boundary.close)
        result = load_save_functions(store, boundary)([article, article, article])
        self.assertEqual(result, {"attempted": 3, "succeeded": 3, "failed": 0})
        self.assertEqual(store.updates, [])
        self.assertEqual(store.stored["keywords"], None)
        self.assertEqual(boundary.starts, 2)
        self.assertTrue(boundary.disabled)

    def test_existing_stored_keywords_are_never_analyzed_or_written_by_metadata(self):
        for keywords in ("[질병군], 별도보상, 코드목록", ["GLP-1", "환자안전"]):
            stored = self.record(keywords)
            store, boundary = Store(stored), Boundary()
            incoming = {k: v for k, v in stored.items() if k != "keywords"}
            result = load_save_functions(store, boundary)([incoming])
            self.assertEqual(result["failed"], 0)
            self.assertEqual(store.stored["keywords"], keywords)
            self.assertEqual(boundary.calls, 0)
            self.assertEqual(store.updates, [])


if __name__ == "__main__":
    unittest.main()
