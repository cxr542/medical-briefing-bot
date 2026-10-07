from __future__ import annotations

import json
from importlib.metadata import version
import sys

from keyword_boundary_contract import MAX_TOKENS, PROCESSOR, PROTOCOL, BoundaryFailure, Frame, Morph, boundary_decision


def emit(value: Frame) -> None:
    sys.stdout.write(json.dumps(value, ensure_ascii=False) + "\n")
    sys.stdout.flush()


def main() -> None:
    try:
        if version("kiwipiepy") != "0.24.0" or version("kiwipiepy_model") != "0.24.0":
            raise BoundaryFailure("package_version")
        from kiwipiepy import Kiwi
        kiwi = Kiwi(num_workers=0, model_type="cong", integrate_allomorph=True,
                    load_default_dict=True, load_typo_dict=True, load_multi_dict=True)
        workers = kiwi.num_workers
        if workers != 1:
            raise BoundaryFailure("worker_count")
    except (ImportError, OSError, RuntimeError, ValueError, MemoryError):
        emit({"version": PROTOCOL, "processor": PROCESSOR, "status": "unavailable"})
        return
    emit({"version": PROTOCOL, "processor": PROCESSOR, "status": "ready"})
    while True:
        line = sys.stdin.buffer.readline(65537)
        if not line:
            return
        if len(line) > 65536 or not line.endswith(b"\n"):
            return
        request = json.loads(line)
        tokens = request.get("tokens")
        if (request.get("version") != PROTOCOL or not isinstance(request.get("id"), int)
                or not isinstance(tokens, list) or not 0 < len(tokens) <= MAX_TOKENS
                or not all(isinstance(token, str) and 0 < len(token) <= 5000 for token in tokens)):
            return
        response = {"version": PROTOCOL, "id": request["id"]}
        try:
            decisions = []
            for token in tokens:
                analyses = kiwi.analyze(token, top_n=1, match_options=0, z_coda=False)
                if not analyses or not analyses[0][0]:
                    raise BoundaryFailure("empty_analysis")
                parts = [Morph(p.form, p.tag, p.start, p.len) for p in analyses[0][0]]
                decisions.append(boundary_decision(token, parts))
            emit({**response, "status": "ok", "decisions": decisions})
        except MemoryError:
            emit({**response, "status": "error", "code": "memory"})
            return
        except (RuntimeError, ValueError, OSError, IndexError, TypeError):
            emit({**response, "status": "error", "code": "analysis"})


if __name__ == "__main__":
    main()
