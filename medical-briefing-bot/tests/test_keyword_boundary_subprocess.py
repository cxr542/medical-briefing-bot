import json
import os
from pathlib import Path
import signal
import sys
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from collector_keyword_boundary import KeywordBoundaryClient, Timeouts
from keyword_boundary_contract import PROCESSOR, PROTOCOL


class SubprocessTests(unittest.TestCase):
    def client(self, mode):
        client = KeywordBoundaryClient(
            [sys.executable, "-u", str(Path(__file__).resolve()), "--fake-child", mode],
            Timeouts(1.0, 0.15, 0.1),
        )
        self.addCleanup(client.close)
        return client

    def test_normal_response_reuses_one_child_without_native_import(self):
        client = self.client("normal")
        result = client.analyze_title("환자안전")
        pid = client.process.pid
        self.assertEqual(result["decisions"], [{"original": "환자안전", "decision": "KEEP", "normalized": "환자안전"}])
        self.assertEqual(client.analyze_title("보험급여")["input_title"], "보험급여")
        self.assertEqual(client.process.pid, pid)
        self.assertEqual(client.starts, 1)
        self.assertNotIn("kiwipiepy", sys.modules)
        self.assertNotIn("_kiwipiepy", sys.modules)

    def test_init_failure_disables_without_respawn(self):
        client = self.client("initfail")
        self.assertIsNone(client.analyze_title("간호사는"))
        self.assertTrue(client.disabled)
        self.assertIsNone(client.analyze_title("전문의는"))
        self.assertEqual(client.starts, 1)

    def test_channel_failures_fall_back_and_second_failure_disables(self):
        for mode in ("timeout", "partial", "malformed", "wrongid", "exit", "nonzero", "brokenpipe", "oversized"):
            with self.subTest(mode=mode):
                client = self.client(mode)
                self.assertIsNone(client.analyze_title("간호사는"))
                self.assertEqual(client.failures, 1)
                self.assertFalse(client.disabled)
                self.assertIsNone(client.analyze_title("전문의는"))
                self.assertTrue(client.disabled)
                self.assertEqual(client.starts, 2)
                self.assertEqual(client.restarts, 1)
                self.assertIsNone(client.analyze_title("치료제는"))
                self.assertEqual(client.starts, 2)

    def test_success_after_restart_does_not_reset_failure_budget(self):
        client = self.client("nonzero")
        self.assertIsNone(client.analyze_title("간호사는"))
        client.command[-1] = "normal"
        self.assertIsNotNone(client.analyze_title("환자안전"))
        self.assertEqual(client.restarts, 1)
        client.process.terminate()
        client.process.wait(timeout=1)
        self.assertIsNone(client.analyze_title("보험급여"))
        self.assertTrue(client.disabled)
        self.assertEqual(client.starts, 2)

    def test_analysis_exception_keeps_child_then_disables_on_repeat(self):
        client = self.client("analysis")
        self.assertIsNone(client.analyze_title("간호사는"))
        pid = client.process.pid
        self.assertIsNone(client.analyze_title("전문의는"))
        self.assertTrue(client.disabled)
        self.assertEqual(client.starts, 1)
        self.assertIsNone(client.process)
        self.assertGreater(pid, 0)

    def test_memory_and_sigkill_disable_without_restart(self):
        for mode in ("memory", "sigkill"):
            with self.subTest(mode=mode):
                client = self.client(mode)
                self.assertIsNone(client.analyze_title("간호사는"))
                self.assertTrue(client.disabled)
                self.assertIsNone(client.analyze_title("보험급여"))
                self.assertEqual(client.starts, 1)

    def test_close_reaps_child_and_prevents_further_spawn(self):
        client = self.client("normal")
        self.assertIsNotNone(client.analyze_title("환자안전"))
        process = client.process
        client.close()
        self.assertIsNotNone(process.poll())
        self.assertIsNone(client.analyze_title("보험급여"))
        self.assertEqual(client.starts, 1)


def fake_child(mode):
    if mode == "brokenpipe":
        os.close(0)
    status = "unavailable" if mode == "initfail" else "ready"
    print(json.dumps({"version": PROTOCOL, "processor": PROCESSOR, "status": status}), flush=True)
    if mode == "initfail":
        return
    if mode == "brokenpipe":
        signal.pause()
    for line in sys.stdin:
        request = json.loads(line)
        response = {"version": PROTOCOL, "id": request["id"], "status": "ok"}
        if mode in ("timeout", "partial"):
            if mode == "partial":
                sys.stdout.write('{"version":')
                sys.stdout.flush()
            signal.pause()
        if mode in ("nonzero", "exit"):
            os._exit(7 if mode == "nonzero" else 0)
        if mode == "sigkill":
            os.kill(os.getpid(), signal.SIGKILL)
        if mode == "malformed":
            print("not JSON", flush=True)
            continue
        if mode == "oversized":
            print("x" * 262145, flush=True)
            continue
        if mode == "wrongid":
            response["id"] += 1
        if mode in ("analysis", "memory"):
            response.update(status="error", code=mode)
        else:
            response["decisions"] = [{"original": t, "decision": "KEEP", "normalized": t} for t in request["tokens"]]
        print(json.dumps(response), flush=True)


if __name__ == "__main__":
    if len(sys.argv) > 1 and sys.argv[1] == "--fake-child":
        fake_child(sys.argv[2])
    else:
        unittest.main()
