from __future__ import annotations

import re
import unicodedata
from typing import Final, NamedTuple, TypedDict

PROTOCOL: Final = 1
FORMAT: Final = "kiwi-title-boundary-v1"
PROCESSOR: Final = "kiwipiepy-0.24.0-cong-boundary-v1"
MAX_TOKENS: Final = 512


class BoundaryFailure(RuntimeError):
    def __init__(self, code: str) -> None:
        self.code = code
        super().__init__(code)


class Decision(TypedDict):
    original: str
    decision: str
    normalized: str | None


class Metadata(TypedDict):
    format_version: str
    processor_version: str
    input_title: str
    decisions: list[Decision]


class Frame(TypedDict, total=False):
    version: int
    processor: str
    status: str
    id: int
    code: str
    decisions: list[Decision]


class Morph(NamedTuple):
    surface: str
    tag: str
    position: int
    length: int


def lexical_tokens(title: str) -> list[str]:
    text = unicodedata.normalize("NFKC", title)
    words: list[str] = []
    word = ""
    for index, char in enumerate(text):
        nominal = unicodedata.category(char)[0] in ("L", "N")
        connector = char in ("-", "·") and word and index + 1 < len(text) and (
            unicodedata.category(text[index + 1])[0] in ("L", "N")
        )
        if nominal or connector:
            word += char
        else:
            if word and word not in words:
                words.append(word)
            word = ""
    if word and word not in words:
        words.append(word)
    return words


def boundary_decision(token: str, parts: list[Morph]) -> Decision:
    predicate = any(re.search(r"^(?:VV|VA|VX|XSV|XSA)(?:-|$)", p.tag) for p in parts)
    if predicate and parts and re.fullmatch(r"EC|ETM|EF", parts[-1].tag):
        return Decision(original=token, decision="REJECT_PREDICATE", normalized=None)
    boundary = len(parts)
    while boundary > 0 and parts[boundary - 1].tag.startswith("J"):
        boundary -= 1
    nominal = all(re.fullmatch(r"NNG|NNP|NNB|NR|NP|SL|SH|SN|XPN|XSN|SO", p.tag)
                  for p in parts[:boundary])
    if 0 < boundary < len(parts) and nominal:
        value = token[:parts[boundary].position]
        return Decision(original=token, decision="NORMALIZE_NOUN", normalized=value)
    return Decision(original=token, decision="KEEP", normalized=token)


def parse_decisions(value: list, tokens: list[str]) -> list[Decision] | None:
    if len(value) != len(tokens):
        return None
    results: list[Decision] = []
    for item, token in zip(value, tokens):
        if not isinstance(item, dict) or item.get("original") != token:
            return None
        operation, normalized = item.get("decision"), item.get("normalized")
        valid = (
            (operation == "KEEP" and normalized == token)
            or (operation == "REJECT_PREDICATE" and normalized is None)
            or (operation == "NORMALIZE_NOUN" and isinstance(normalized, str)
                and bool(normalized) and normalized != token and token.startswith(normalized))
        )
        if not valid:
            return None
        results.append(Decision(original=token, decision=operation, normalized=normalized))
    return results
