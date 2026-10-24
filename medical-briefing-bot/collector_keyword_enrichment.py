from __future__ import annotations

from collections.abc import Callable
from typing import TypedDict

from collector_keyword_boundary import KeywordBoundaryClient
from keyword_boundary_contract import Metadata

EXCLUDED_SOURCES = frozenset(("국가법령정보센터", "보건복지부 법령", "데일리메디"))


class SavedArticle(TypedDict, total=False):
    title: str
    url: str
    source: str
    status: str
    keywords: str | list[str] | None


def enrich_saved_article(snapshot: SavedArticle, boundary: KeywordBoundaryClient,
                         write: Callable[[SavedArticle, Metadata], bool]) -> bool | None:
    if (snapshot.get("status") not in ("NEW", "UPDATE")
            or snapshot.get("source") in EXCLUDED_SOURCES
            or "keywords" not in snapshot or snapshot["keywords"] not in (None, "", [])
            or not isinstance(snapshot.get("title"), str) or not isinstance(snapshot.get("url"), str)):
        return
    metadata = boundary.analyze_title(snapshot["title"])
    if metadata is not None:
        return write(snapshot, metadata)
    return None
