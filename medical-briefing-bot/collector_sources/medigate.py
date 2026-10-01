from datetime import date, datetime, timedelta, timezone
import json
from typing import Callable, Dict, Final, List, NamedTuple, NewType, Optional, Tuple, TypedDict, Union
from urllib.parse import urlencode

from collector_parsers import get_content_hash


SOURCE_NAME: Final = "메디게이트뉴스"
ENDPOINT: Final = "https://www.medigatenews.com/section/date"
MAX_DATE_ITERATIONS: Final = 14
KST: Final = timezone(timedelta(hours=9))
UTC: Final = timezone.utc
MedigateNewsId = NewType("MedigateNewsId", int)


class MedigateArticle(NamedTuple):
    news_id: MedigateNewsId
    title: str
    published_at: datetime


class MedigatePage(NamedTuple):
    articles: Tuple[MedigateArticle, ...]
    next_date: Optional[date]


class MedigateArticleRecord(TypedDict):
    source: str
    title: str
    url: str
    published_date: str
    content_hash: str
    status: str


class MedigateSourceError(ValueError):
    reason: str

    def __init__(self, reason: str) -> None:
        self.reason = reason
        super().__init__(reason)


def build_date_url(cursor: date) -> str:
    query = urlencode({"date": cursor.isoformat(), "allOfDateFlag": "N"})
    return f"{ENDPOINT}?{query}"


def _parse_date(value: str, *, field: str) -> date:
    try:
        parsed = datetime.strptime(value, "%Y-%m-%d").date()
    except ValueError as error:
        raise MedigateSourceError(f"invalid {field} date") from error
    if parsed.isoformat() != value:
        raise MedigateSourceError(f"invalid {field} date")
    return parsed


def _parse_news_id(value: Union[int, str, bool, None]) -> Optional[MedigateNewsId]:
    if isinstance(value, int) and not isinstance(value, bool):
        news_id = value
    elif isinstance(value, str) and value.isdecimal():
        news_id = int(value)
    else:
        return None
    return MedigateNewsId(news_id) if news_id > 0 else None


def _parse_published_at(value: Union[int, float, str, bool, None]) -> Optional[datetime]:
    if not isinstance(value, int) or isinstance(value, bool) or value <= 0:
        return None
    seconds, milliseconds = divmod(value, 1000)
    try:
        return datetime.fromtimestamp(seconds, tz=UTC) + timedelta(milliseconds=milliseconds)
    except (OverflowError, OSError, ValueError):
        return None


def parse_medigate_page(response_body: bytes) -> MedigatePage:
    try:
        payload = json.loads(response_body.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError) as error:
        raise MedigateSourceError("response is not valid UTF-8 JSON") from error

    if not isinstance(payload, dict) or not isinstance(payload.get("list"), list):
        raise MedigateSourceError("unexpected response root")

    next_date_value = payload.get("nextDate")
    if next_date_value is None:
        next_date = None
    elif isinstance(next_date_value, str):
        next_date = _parse_date(next_date_value, field="nextDate")
    else:
        raise MedigateSourceError("invalid nextDate type")

    articles_by_id: Dict[MedigateNewsId, MedigateArticle] = {}
    for group in payload["list"]:
        if not isinstance(group, dict):
            raise MedigateSourceError("invalid date group")
        group_date = group.get("date")
        if not isinstance(group_date, str):
            raise MedigateSourceError("date group is missing date")
        _parse_date(group_date, field="group")
        news_list = group.get("newsList")
        if not isinstance(news_list, list):
            raise MedigateSourceError("date group is missing newsList")

        for item in news_list:
            if not isinstance(item, dict):
                continue
            news_id = _parse_news_id(item.get("news_id"))
            title = item.get("display_title")
            published_at = _parse_published_at(item.get("display_modified_date"))
            if news_id is None or not isinstance(title, str) or not title.strip() or published_at is None:
                continue
            if news_id not in articles_by_id:
                articles_by_id[news_id] = MedigateArticle(news_id, title.strip(), published_at)

    return MedigatePage(tuple(articles_by_id.values()), next_date)


def _article_record(article: MedigateArticle) -> MedigateArticleRecord:
    url = f"https://www.medigatenews.com/news/{article.news_id}"
    return {
        "source": SOURCE_NAME,
        "title": article.title,
        "url": url,
        "published_date": article.published_at.isoformat(),
        "content_hash": get_content_hash(article.title + url),
        "status": "NEW",
    }


def collect_recent_articles(
    fetch_page: Callable[[date], bytes],
    *,
    now: Optional[datetime] = None,
    max_iterations: int = MAX_DATE_ITERATIONS,
) -> List[MedigateArticleRecord]:
    current_time = now or datetime.now(UTC)
    if current_time.tzinfo is None:
        current_time = current_time.replace(tzinfo=UTC)
    if max_iterations < 1:
        raise MedigateSourceError("date iteration limit must be positive")

    cutoff = current_time.astimezone(UTC) - timedelta(days=7)
    cutoff_date = cutoff.astimezone(KST).date()
    cursor = current_time.astimezone(KST).date()
    seen_dates: set[date] = set()
    articles_by_id: Dict[MedigateNewsId, MedigateArticle] = {}

    for _ in range(max_iterations):
        if cursor in seen_dates:
            raise MedigateSourceError("repeated date cursor")
        seen_dates.add(cursor)
        page = parse_medigate_page(fetch_page(cursor))
        for article in page.articles:
            if article.published_at >= cutoff and article.news_id not in articles_by_id:
                articles_by_id[article.news_id] = article

        if page.next_date is None:
            if cursor <= cutoff_date:
                break
            raise MedigateSourceError("nextDate missing before the seven-day cutoff")
        if page.next_date in seen_dates:
            raise MedigateSourceError("repeated nextDate cursor")
        if page.next_date >= cursor:
            raise MedigateSourceError("nextDate did not move backward")
        if page.next_date < cutoff_date:
            break
        cursor = page.next_date
    else:
        raise MedigateSourceError("maximum date iterations exceeded")

    return [_article_record(article) for article in articles_by_id.values()]
