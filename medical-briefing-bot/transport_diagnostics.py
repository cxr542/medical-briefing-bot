from dataclasses import asdict, dataclass
import json
import math
import os
import platform
import ssl
import subprocess
import time
import traceback
from typing import Final, Optional

import requests
import urllib3


@dataclass(frozen=True)
class Endpoint:
    name: str
    url: str


@dataclass(frozen=True)
class Probe:
    client: str
    http_status: Optional[int]
    elapsed_ms: int
    error_code: Optional[str] = None
    connect_ms: Optional[float] = None
    appconnect_ms: Optional[float] = None
    failure_frames: tuple[str, ...] = ()


ENDPOINTS: Final = (
    Endpoint("dailymedi_listing_8", "https://www.dailymedi.com/news/news_list.php?ca_id=22&page=8"),
    Endpoint("dailymedi_detail_941444", "https://www.dailymedi.com/news/news_view.php?ca_id=21&wr_id=941444"),
)
USER_AGENT: Final = "Mozilla/5.0 (compatible; MedicalBriefingBot/1.0)"


def requests_probe(endpoint: Endpoint) -> Probe:
    started = time.monotonic()
    try:
        with requests.Session() as session:
            session.trust_env = False
            session.max_redirects = 5
            with session.get(endpoint.url, headers={"User-Agent": USER_AGENT},
                             timeout=(5, 20), stream=True, verify=True) as response:
                size = 0
                for chunk in response.iter_content(65536):
                    size += len(chunk)
                    if size > 1048576:
                        return Probe("requests", None, round((time.monotonic() - started) * 1000),
                                     "body_limit")
                return Probe("requests", response.status_code,
                             round((time.monotonic() - started) * 1000))
    except requests.RequestException as error:
        return Probe("requests", None, round((time.monotonic() - started) * 1000),
                     type(error).__name__, failure_frames=tuple(
                         frame.name for frame in traceback.extract_tb(error.__traceback__)[-8:]))


def curl_probe(endpoint: Endpoint) -> Probe:
    started = time.monotonic()
    environment = {key: os.environ[key] for key in ("PATH", "SYSTEMROOT") if key in os.environ}
    try:
        result = subprocess.run(
            ["curl", "--disable", "--silent", "--location", "--max-redirs", "5",
             "--connect-timeout", "5", "--max-time", "25", "--max-filesize", "1048576",
             "--user-agent", USER_AGENT,
             "--output", os.devnull, "--write-out",
             "%{http_code}|%{time_connect}|%{time_appconnect}", endpoint.url],
            capture_output=True, text=True, timeout=30, check=False, env=environment,
        )
    except subprocess.TimeoutExpired:
        return Probe("curl", None, round((time.monotonic() - started) * 1000), "process_timeout")
    except OSError:
        return Probe("curl", None, round((time.monotonic() - started) * 1000), "process_unavailable")
    elapsed = round((time.monotonic() - started) * 1000)
    if result.returncode != 0:
        return Probe("curl", None, elapsed, f"curl_exit_{result.returncode}")
    try:
        status, connect, tls = result.stdout.strip().split("|")
        status_code = int(status)
        connect_ms, appconnect_ms = float(connect) * 1000, float(tls) * 1000
        if (not 100 <= status_code <= 599 or connect_ms < 0 or appconnect_ms < 0
                or not math.isfinite(connect_ms) or not math.isfinite(appconnect_ms)):
            raise ValueError
    except ValueError:
        return Probe("curl", None, elapsed, "invalid_metrics")
    return Probe("curl", status_code, elapsed, connect_ms=connect_ms, appconnect_ms=appconnect_ms)


def main() -> int:
    print(json.dumps({"kind": "runtime", "python": platform.python_version(),
                      "openssl": ssl.OPENSSL_VERSION, "requests": requests.__version__,
                      "urllib3": urllib3.__version__, "trust_env": False,
                      "tls_verification": True, "rounds": 2}, sort_keys=True))
    failures = 0
    for round_number, probes in enumerate(((requests_probe, curl_probe), (curl_probe, requests_probe)), start=1):
        for endpoint in ENDPOINTS:
            for probe in probes:
                result = probe(endpoint)
                failures += int(result.error_code is not None or result.http_status != 200)
                print(json.dumps({"kind": "probe", "endpoint": endpoint.name,
                                  "round": round_number, **asdict(result)}, sort_keys=True), flush=True)
    print(json.dumps({"kind": "summary", "probes": len(ENDPOINTS) * 4,
                      "failed_or_non_200": failures}, sort_keys=True))
    return int(failures > 0)


if __name__ == "__main__":
    raise SystemExit(main())
