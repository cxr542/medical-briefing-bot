from __future__ import annotations

import json
import os
from pathlib import Path
import selectors
import signal
import subprocess
import sys
import time
from typing import Final, NamedTuple, TypedDict

from keyword_boundary_contract import FORMAT, PROCESSOR, PROTOCOL, MAX_TOKENS, Frame, Metadata, lexical_tokens, parse_decisions

MAX_REQUEST: Final = 65536
MAX_RESPONSE: Final = 262144


class Timeouts(NamedTuple):
    startup: float = 10.0
    request: float = 5.0
    shutdown: float = 1.0


class ChannelFailure(Exception):
    def __init__(self, code: str, subcode: str | None = None) -> None:
        self.code = code
        self.subcode = subcode or code
        super().__init__(code)


class Diagnostic(TypedDict, total=False):
    phase: str
    response_bytes: int
    line_bytes: int
    remainder_bytes: int
    newline_observed: bool
    json_parse_succeeded: bool
    frame_was_object: bool
    schema_valid: bool
    request_id_matched: bool


class KeywordBoundaryClient:
    def __init__(self, command: list[str] | None = None, timeouts: Timeouts = Timeouts()) -> None:
        self.command = command or [sys.executable, "-u", str(Path(__file__).with_name("collector_keyword_boundary_child.py"))]
        self.timeouts = timeouts
        self.process: subprocess.Popen | None = None
        self.failures = 0
        self.restarts = 0
        self.starts = 0
        self.disabled = False
        self.request_id = 0
        self.buffer = bytearray()
        self.diagnostic: Diagnostic = {}

    def _read(self, deadline: float, phase: str = "response") -> Frame:
        self.diagnostic = Diagnostic(phase=phase, response_bytes=len(self.buffer), newline_observed=False)
        process = self.process
        if process is None or process.stdout is None:
            raise ChannelFailure("unavailable")
        with selectors.DefaultSelector() as selector:
            selector.register(process.stdout, selectors.EVENT_READ)
            while True:
                if b"\n" in self.buffer:
                    line, _, remainder = self.buffer.partition(b"\n")
                    self.diagnostic.update(line_bytes=len(line), remainder_bytes=len(remainder), newline_observed=True)
                    self.buffer = bytearray(remainder)
                    if len(line) > MAX_RESPONSE or remainder:
                        raise ChannelFailure("malformed", "oversized_line" if len(line) > MAX_RESPONSE else "buffered_remainder")
                    try:
                        value = json.loads(line)
                    except (ValueError, UnicodeError, RecursionError) as error:
                        self.diagnostic["json_parse_succeeded"] = False
                        raise ChannelFailure("malformed", "invalid_json") from error
                    self.diagnostic.update(json_parse_succeeded=True, frame_was_object=isinstance(value, dict))
                    if not isinstance(value, dict):
                        raise ChannelFailure("malformed", "non_object_frame")
                    return value
                remaining = deadline - time.monotonic()
                if remaining <= 0 or not selector.select(remaining):
                    raise ChannelFailure("timeout")
                try:
                    chunk = os.read(process.stdout.fileno(), 16384)
                except BlockingIOError:
                    continue
                if not chunk:
                    raise ChannelFailure("exit")
                self.buffer.extend(chunk)
                self.diagnostic.update(response_bytes=len(self.buffer), newline_observed=b"\n" in self.buffer)
                if len(self.buffer) > MAX_RESPONSE:
                    line, separator, remainder = self.buffer.partition(b"\n")
                    if separator:
                        self.diagnostic.update(line_bytes=len(line), remainder_bytes=len(remainder))
                    raise ChannelFailure("oversized", "oversized_line" if len(line) > MAX_RESPONSE else "oversized")

    def _write(self, data: bytes, deadline: float) -> None:
        self.diagnostic = Diagnostic(phase="write")
        process = self.process
        if process is None or process.stdin is None:
            raise ChannelFailure("unavailable")
        with selectors.DefaultSelector() as selector:
            selector.register(process.stdin, selectors.EVENT_WRITE)
            offset = 0
            while offset < len(data):
                remaining = deadline - time.monotonic()
                if remaining <= 0 or not selector.select(remaining):
                    raise ChannelFailure("timeout")
                try:
                    offset += os.write(process.stdin.fileno(), data[offset:])
                except BlockingIOError:
                    continue

    def _stop(self) -> bool:
        process = self.process
        if process is None:
            return True
        if process.stdin is not None:
            try:
                process.stdin.close()
            except OSError:
                self.disabled = True
        for operation in (None, process.terminate, process.kill):
            if operation is not None and process.poll() is None:
                try:
                    operation()
                except ProcessLookupError:
                    continue
                except OSError:
                    return False
            try:
                process.wait(timeout=self.timeouts.shutdown)
                break
            except subprocess.TimeoutExpired:
                continue
            except OSError:
                return False
        exited = process.poll() is not None
        if process.stdout is not None:
            try:
                process.stdout.close()
            except OSError:
                return False
        if exited:
            self.process = None
        self.buffer.clear()
        return exited

    def _fail(self, code: str, terminal: bool = False, subcode: str | None = None) -> None:
        self.failures += 1
        process = self.process
        if process is not None:
            try:
                process.wait(timeout=0.05)
            except subprocess.TimeoutExpired:
                terminal = bool(terminal)
            terminal = terminal or process.returncode == -signal.SIGKILL
        pid = process.pid if process is not None else None
        exit_status = process.returncode if process is not None else None
        cleaned = self._stop()
        self.disabled = terminal or not cleaned or self.failures >= 2 or self.restarts >= 1
        diagnostic = {**self.diagnostic, "subcode": subcode or code, "request_id": self.request_id,
                      "child_pid": pid, "child_exit_status": exit_status, "restarts": self.restarts,
                      "failures": self.failures, "disabled": self.disabled}
        print(f"Kiwi fallback: code={code} failures={self.failures} disabled={int(self.disabled)} diagnostics={json.dumps(diagnostic)}")

    def _start(self) -> bool:
        self.diagnostic = Diagnostic(phase="ready")
        if self.starts:
            self.restarts += 1
        self.starts += 1
        self.process = subprocess.Popen(self.command, stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                                        stderr=subprocess.DEVNULL, bufsize=0, shell=False, start_new_session=True)
        if self.process.stdin is None or self.process.stdout is None:
            raise ChannelFailure("unavailable")
        os.set_blocking(self.process.stdin.fileno(), False)
        os.set_blocking(self.process.stdout.fileno(), False)
        ready = self._read(time.monotonic() + self.timeouts.startup, "ready")
        if ready.get("version") != PROTOCOL or ready.get("processor") != PROCESSOR:
            self.diagnostic["schema_valid"] = False
            raise ChannelFailure("malformed", "invalid_schema")
        self.diagnostic["schema_valid"] = True
        if ready.get("status") != "ready":
            self._fail("initialization", terminal=True)
            return False
        print("Kiwi initialized")
        return True

    def analyze_title(self, title: str) -> Metadata | None:
        if self.disabled or not title or len(title) > 5000:
            return None
        tokens = lexical_tokens(title)
        if not tokens or len(tokens) > MAX_TOKENS:
            return None
        self.request_id += 1
        data = (json.dumps({"version": PROTOCOL, "id": self.request_id, "tokens": tokens}, ensure_ascii=False) + "\n").encode()
        if len(data) > MAX_REQUEST:
            return None
        try:
            if self.process is None and not self._start():
                return None
            deadline = time.monotonic() + self.timeouts.request
            self._write(data, deadline)
            response = self._read(deadline)
            self.diagnostic["request_id_matched"] = response.get("id") == self.request_id
            if response.get("version") != PROTOCOL or response.get("id") != self.request_id:
                self.diagnostic["schema_valid"] = False
                raise ChannelFailure("malformed", "invalid_schema" if response.get("version") != PROTOCOL else "request_id_mismatch")
            if response.get("status") == "error" and response.get("code") in ("memory", "analysis"):
                self.failures += 1
                if response.get("code") == "memory" or self.failures >= 2:
                    self.disabled = True
                    self._stop()
                print(f"Kiwi analysis fallback: failures={self.failures} disabled={int(self.disabled)}")
                return None
            if response.get("status") != "ok":
                self.diagnostic["schema_valid"] = False
                raise ChannelFailure("malformed", "invalid_schema")
            values = response.get("decisions")
            decisions = parse_decisions(values, tokens) if isinstance(values, list) else None
            if decisions is None:
                self.diagnostic["schema_valid"] = False
                raise ChannelFailure("malformed", "invalid_schema")
            return Metadata(format_version=FORMAT, processor_version=PROCESSOR, input_title=title, decisions=decisions)
        except (ChannelFailure, OSError, ValueError, subprocess.SubprocessError) as error:
            subcode = error.subcode if isinstance(error, ChannelFailure) else (
                "broken_pipe" if isinstance(error, BrokenPipeError) else "channel")
            self._fail(error.code if isinstance(error, ChannelFailure) else "channel", subcode=subcode)
            return None

    def close(self) -> None:
        self.disabled = True
        self._stop()
