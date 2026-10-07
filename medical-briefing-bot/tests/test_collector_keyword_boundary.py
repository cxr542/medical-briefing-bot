import copy
import json
import os
from pathlib import Path
import resource
import unittest

from collector_keyword_boundary import KeywordBoundaryClient
from collector_keyword_enrichment import enrich_saved_article
from keyword_boundary_contract import Morph, boundary_decision, lexical_tokens

FIXTURE = json.loads((Path(__file__).parent / "fixtures/keyword_boundary_challenge.json").read_text())


class GuardTests(unittest.TestCase):
    def test_frozen_38_gold_contract_without_loading_model(self):
        self.assertEqual(len(FIXTURE), 38)
        for row in FIXTURE:
            with self.subTest(token=row["token"]):
                parts = [Morph(**part) for part in row["morphology"]]
                result = boundary_decision(row["token"], parts)
                expected = row["token"] if row["gold"]["label"] == "AMBIGUOUS" else row["gold"]["normalized"]
                self.assertEqual(result["normalized"], expected)
                self.assertEqual(result["decision"], row["decision"])

    def test_unicode_lexical_pool_preserves_connectors_and_nfkc(self):
        self.assertEqual(lexical_tokens("[환자안전] ＡＩ의 GLP-1 COVID-19 환자안전"),
                         ["환자안전", "AI의", "GLP-1", "COVID-19"])

    def test_stored_and_excluded_records_never_enter_kiwi_path(self):
        client = KeywordBoundaryClient(["must-not-spawn"])
        for keywords in ("[질병군], 별도보상, 코드목록", ["GLP-1"], "null", {"unexpected": True}):
            row = {"title": "간호사는", "url": "https://example.test/a", "status": "UPDATE", "keywords": keywords}
            original = copy.deepcopy(row)
            enrich_saved_article(row, client, lambda *_: self.fail("must not write"))
            self.assertEqual(row, original)
        for source in ("데일리메디", "국가법령정보센터", "보건복지부 법령"):
            enrich_saved_article({"title": "간호사는", "url": "https://example.test/a", "status": "NEW", "keywords": None, "source": source},
                                 client, lambda *_: self.fail("must not write"))
        self.assertEqual(client.starts, 0)

    def test_unavailable_child_keeps_article_and_original_keywords(self):
        client = KeywordBoundaryClient(["nonexistent-keyword-child"])
        self.addCleanup(client.close)
        row = {"title": "간호사는", "url": "https://example.test/a", "status": "NEW", "keywords": None}
        original = copy.deepcopy(row)
        writes = []
        enrich_saved_article(row, client, lambda *values: writes.append(values))
        self.assertEqual(row, original)
        self.assertEqual(writes, [])


@unittest.skipUnless(os.environ.get("KIWI_NATIVE_SMOKE") == "1", "optional pinned native smoke")
class NativeSmokeTests(unittest.TestCase):
    def test_actual_child_frozen_gold_and_memory_observation(self):
        client = KeywordBoundaryClient()
        self.addCleanup(client.close)
        for row in FIXTURE:
            with self.subTest(token=row["token"]):
                result = client.analyze_title(row["token"])
                self.assertIsNotNone(result)
                self.assertEqual(result["decisions"][0]["decision"], row["decision"])
                self.assertEqual(result["decisions"][0]["normalized"], row["normalized"])
        self.assertEqual(client.starts, 1)
        if Path("/proc").exists():
            status = Path(f"/proc/{client.process.pid}/status").read_text()
            rss = next(line for line in status.splitlines() if line.startswith("VmRSS:"))
            print(f"Kiwi child memory observed: {rss}; parent peak KiB={resource.getrusage(resource.RUSAGE_SELF).ru_maxrss}")


if __name__ == "__main__":
    unittest.main()
