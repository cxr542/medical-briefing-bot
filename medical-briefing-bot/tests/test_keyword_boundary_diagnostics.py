import os
import time
import unittest
from types import SimpleNamespace
from unittest.mock import patch

from collector_keyword_boundary import ChannelFailure, KeywordBoundaryClient, MAX_RESPONSE


class FrameDiagnosticTests(unittest.TestCase):
    def client(self):
        read_fd, write_fd = os.pipe()
        reader = os.fdopen(read_fd, "rb", buffering=0)
        self.addCleanup(reader.close)
        self.addCleanup(os.close, write_fd)
        os.write(write_fd, b"x")
        client = KeywordBoundaryClient()
        client.process = SimpleNamespace(stdout=reader)
        return client

    def test_partial_frame_completed_by_later_read_is_valid(self):
        client = self.client()
        with patch("collector_keyword_boundary.os.read", side_effect=[b'{"version":', b'1}\n']):
            result = client._read(time.monotonic() + 1)
        self.assertEqual(result, {"version": 1})
        self.assertEqual(client.diagnostic["response_bytes"], 14)
        self.assertTrue(client.diagnostic["json_parse_succeeded"])
        self.assertTrue(client.diagnostic["frame_was_object"])

    def test_coalesced_frame_and_remainder_remains_rejected(self):
        for remainder in (b'{"version":1}\n', b'{"version":'):
            with self.subTest(remainder=remainder):
                client = self.client()
                with patch("collector_keyword_boundary.os.read", return_value=b'{"version":1}\n' + remainder):
                    with self.assertRaises(ChannelFailure) as raised:
                        client._read(time.monotonic() + 1)
                self.assertEqual(raised.exception.code, "malformed")
                self.assertEqual(raised.exception.subcode, "buffered_remainder")
                self.assertEqual(client.diagnostic["remainder_bytes"], len(remainder))
                self.assertTrue(client.diagnostic["newline_observed"])

    def test_frame_parse_failure_facts(self):
        for payload, subcode in ((b'PRIVATE_FRAME\n', "invalid_json"), (b'["PRIVATE_FRAME"]\n', "non_object_frame")):
            with self.subTest(subcode=subcode):
                client = self.client()
                with patch("collector_keyword_boundary.os.read", return_value=payload):
                    with self.assertRaises(ChannelFailure) as raised:
                        client._read(time.monotonic() + 1)
                self.assertEqual(raised.exception.subcode, subcode)
                self.assertEqual(client.diagnostic["line_bytes"], len(payload) - 1)
                self.assertEqual(client.diagnostic["json_parse_succeeded"], subcode != "invalid_json")
                if subcode == "non_object_frame":
                    self.assertFalse(client.diagnostic["frame_was_object"])

    def test_prebuffered_oversized_line_preserves_malformed_classification(self):
        client = self.client()
        client.buffer = bytearray(b'x' * (MAX_RESPONSE + 1) + b'\n')
        with self.assertRaises(ChannelFailure) as raised:
            client._read(time.monotonic() + 1)
        self.assertEqual(raised.exception.code, "malformed")
        self.assertEqual(raised.exception.subcode, "oversized_line")
        self.assertEqual(client.diagnostic["line_bytes"], MAX_RESPONSE + 1)
