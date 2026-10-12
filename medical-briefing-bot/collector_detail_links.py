"""Optional display metadata; never an article identity or lifecycle signal."""
from __future__ import annotations

from datetime import datetime
import re
from urllib.parse import parse_qs, urlsplit

from postgrest.exceptions import APIError

DETAIL_FIELD = "source_detail_url"
KDCA_SOURCE = "질병관리청 보도자료"
KDCA_LIST_PATH = "/bbs/kdca/42/artclList.do"
KDCA_DETAIL = re.compile(r"https://www\.kdca\.go\.kr/bbs/kdca/42/[1-9][0-9]{0,17}/artclView\.do")
GUARD_FIELDS = ("id", "url", "source", "title", "content_hash", "status", "published_date")


def safe_https_url(value: object) -> str | None:
    if not isinstance(value, str) or not value.startswith("https://"):
        return None
    if re.search(r"[\x00-\x20\x7f\\]", value):
        return None
    try:
        url = urlsplit(value)
        if (not url.hostname or url.username is not None or url.password is not None
                or url.port is not None or url.netloc != url.hostname):
            return None
    except ValueError:
        return None
    if re.fullmatch(r"[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+", url.hostname) is None:
        return None
    return value


def validated_source_detail_url(article: dict) -> str | None:
    value = safe_https_url(article.get(DETAIL_FIELD))
    identity = safe_https_url(article.get("url"))
    # Start with the already established KDCA path contract. Unsupported sources
    # are not upgraded by merely supplying an HTTPS URL. No JS parser lives here.
    if (article.get("source") != KDCA_SOURCE or value is None or identity is None
            or KDCA_DETAIL.fullmatch(value) is None):
        return None
    if identity == value:
        return value
    try:
        url = urlsplit(identity)
        query = parse_qs(url.query, keep_blank_values=True, strict_parsing=True)
    except ValueError:
        return None
    if (url.netloc != "www.kdca.go.kr" or url.path != KDCA_LIST_PATH or "#" in identity
            or query != {"page": ["1"], "srchColumn": ["title"], "srchWrd": [article.get("title")]}):
        return None
    return value


def primary_article_payload(article: dict) -> dict:
    # Also strip metadata copied from old DELETED snapshots: never clear or
    # overwrite a racing valid value through an ordinary upsert.
    return {key: value for key, value in article.items() if key != DETAIL_FIELD}


def _same_publication(left: object, right: object) -> bool:
    if not isinstance(left, str) or not isinstance(right, str):
        return False
    try:
        a = datetime.fromisoformat(left.replace("Z", "+00:00"))
        b = datetime.fromisoformat(right.replace("Z", "+00:00"))
    except ValueError:
        return False
    return a.tzinfo is not None and b.tzinfo is not None and a == b


def save_source_detail_urls(client, candidates: list, snapshots: list, *, blocked_urls=()) -> dict:
    """Fill NULL metadata on persisted active rows using revision guards.

    Primary saves happen separately. Missing schema, CAS misses and optional
    errors never change primary save counts or Collector health/recovery inputs.
    """
    stats = dict(updated=0, unchanged=0, conflict=0, invalid=0, skipped=0, unavailable=0, failed=0)
    incoming = {}
    conflicts = set()
    for article in candidates:
        if article.get(DETAIL_FIELD) is None:
            continue
        value = validated_source_detail_url(article)
        if value is None:
            stats["invalid"] += 1
            continue
        identity = article["url"]
        prior = incoming.get(identity)
        if prior is not None and (
            prior[DETAIL_FIELD] != value or any(prior.get(k) != article.get(k)
                                              for k in ("source", "title", "content_hash", "published_date"))
        ):
            conflicts.add(identity)
        incoming[identity] = article

    # Later successful-save representations supersede earlier read snapshots.
    persisted = {row["url"]: row for row in snapshots if isinstance(row, dict) and "url" in row}
    blocked = set(blocked_urls)
    plans = []
    for identity, article in incoming.items():
        old = persisted.get(identity)
        if identity in conflicts:
            stats["conflict"] += 1
            continue
        if (identity in blocked or old is None or old.get("status") not in {"NEW", "UPDATE"}
                or not isinstance(old.get("id"), int) or isinstance(old["id"], bool) or old["id"] <= 0):
            stats["skipped"] += 1
            continue
        if (any(old.get(k) != article.get(k) for k in ("source", "title", "content_hash"))
                or not _same_publication(old.get("published_date"), article.get("published_date"))):
            stats["skipped"] += 1
            continue
        existing = old.get(DETAIL_FIELD)
        if existing is not None:
            stats["unchanged" if existing == article[DETAIL_FIELD] else "conflict"] += 1
            continue
        plans.append((old, article[DETAIL_FIELD]))

    for index, (snapshot, value) in enumerate(plans):
        try:
            query = client.table("articles").update({DETAIL_FIELD: value})
            for field in GUARD_FIELDS:
                expected = snapshot.get(field)
                query = query.is_(field, "null") if expected is None else query.eq(field, expected)
            response = query.is_(DETAIL_FIELD, "null").execute()
            if isinstance(response.data, list) and response.data:
                stats["updated"] += 1
            else:
                stats["skipped"] += 1  # A concurrent revision/value change is a safe CAS miss.
        except APIError as error:
            if (error.code in {"PGRST204", "42703"}
                    and DETAIL_FIELD in (error.message or "")):
                stats["unavailable"] += len(plans) - index
                break  # Schema absent/cache not ready: do not retry each remaining row.
            stats["failed"] += 1
        except Exception:
            # This optional boundary reports failure without printing request URLs,
            # error bodies, credentials or changing a successful primary save.
            stats["failed"] += 1

    if any(stats.values()):
        print("Source detail metadata: " + " ".join(f"{key}={value}" for key, value in stats.items()))
    return stats
