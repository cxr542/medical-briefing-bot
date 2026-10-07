from __future__ import annotations

import json
import os
from pathlib import Path
import selectors
import signal
import subprocess
import sys
import time
from typing import Final, NamedTuple

from keyword_boundary_contract import FORMAT, PROCESSOR, PROTOCOL, MAX_TOKENS, Frame, Metadata, lexical_tokens, parse_decisions

MAX_REQUEST: Final = 65536
MAX_RESPONSE: Final = 262144


class Timeouts(NamedTuple):
    startup: float = 10.0
    request: float = 5.0
    shutdown: float = 1.0


class ChannelFailure(Exception):
    def __init__(self, code: str) -> None:
        self.code = code
        super().__init__(code)


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

    def _read(self, deadline: float) -> Frame:
        process = self.process
        if process is None or process.stdout is None:
            raise ChannelFailure("unavailable")
        with selectors.DefaultSelector() as selector:
            selector.register(process.stdout, selectors.EVENT_READ)
            while True:
                if b"\n" in self.buffer:
                    line, _, remainder = self.buffer.partition(b"\n")
                    self.buffer = bytearray(remainder)
                    if len(line) > MAX_RESPONSE or remainder:
                        raise ChannelFailure("malformed")
                    try:
                        value = json.loads(line)
                    except (ValueError, UnicodeError, RecursionError) as error:
                        raise ChannelFailure("malformed") from error
                    if not isinstance(value, dict):
                        raise ChannelFailure("malformed")
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
                if len(self.buffer) > MAX_RESPONSE:
                    raise ChannelFailure("oversized")

    def _write(self, data: bytes, deadline: float) -> None:
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

    def _fail(self, code: str, terminal: bool = False) -> None:
        self.failures += 1
        process = self.process
        if process is not None:
            try:
                process.wait(timeout=0.05)
            except subprocess.TimeoutExpired:
                terminal = bool(terminal)
            terminal = terminal or process.returncode == -signal.SIGKILL
        cleaned = self._stop()
        self.disabled = terminal or not cleaned or self.failures >= 2 or self.restarts >= 1
        print(f"Kiwi fallback: code={code} failures={self.failures} disabled={int(self.disabled)}")

    def _start(self) -> bool:
        if self.starts:
            self.restarts += 1
        self.starts += 1
        self.process = subprocess.Popen(self.command, stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                                        stderr=subprocess.DEVNULL, bufsize=0, shell=False, start_new_session=True)
        if self.process.stdin is None or self.process.stdout is None:
            raise ChannelFailure("unavailable")
        os.set_blocking(self.process.stdin.fileno(), False)
        os.set_blocking(self.process.stdout.fileno(), False)
        ready = self._read(time.monotonic() + self.timeouts.startup)
        if ready.get("version") != PROTOCOL or ready.get("processor") != PROCESSOR:
            raise ChannelFailure("malformed")
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
            if response.get("version") != PROTOCOL or response.get("id") != self.request_id:
                raise ChannelFailure("malformed")
            if response.get("status") == "error" and response.get("code") in ("memory", "analysis"):
                self.failures += 1
                if response.get("code") == "memory" or self.failures >= 2:
                    self.disabled = True
                    self._stop()
                print(f"Kiwi analysis fallback: failures={self.failures} disabled={int(self.disabled)}")
                return None
            if response.get("status") != "ok":
                raise ChannelFailure("malformed")
            values = response.get("decisions")
            decisions = parse_decisions(values, tokens) if isinstance(values, list) else None
            if decisions is None:
                raise ChannelFailure("malformed")
            return Metadata(format_version=FORMAT, processor_version=PROCESSOR, input_title=title, decisions=decisions)
        except (ChannelFailure, OSError, ValueError, subprocess.SubprocessError) as error:
            self._fail(error.code if isinstance(error, ChannelFailure) else "channel")
            return None

    def close(self) -> None:
        self.disabled = True
        self._stop()
