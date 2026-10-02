from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
import re
import time
from typing import Callable, Dict, List, Optional, Set, Tuple
from urllib.parse import parse_qs, urljoin, urlparse

from bs4 import BeautifulSoup
import requests

from collector_parsers import get_content_hash


SOURCE_NAME = "데일리메디"
LIST_URL = "https://www.dailymedi.com/news/news_list.php"
SECTION_IDS = ("22", "21", "31")
MAX_PAGES_PER_SECTION = 10
ALLOWED_HOSTS = frozenset({"dailymedi.com", "www.dailymedi.com"})
KST = timezone(timedelta(hours=9))
RETRY_BACKOFFS = (1, 2)
TRANSIENT_ERRORS = (
    requests.exceptions.ConnectionError,
    requests.exceptions.Timeout,
    requests.exceptions.ChunkedEncodingError,
)
_DATE_FORMATS = (
    "%Y-%m-%d %H:%M",
    "%Y.%m.%d %H:%M",
    "%Y.%m.%d %H:%M:%S",
    "%Y-%m-%d",
    "%Y.%m.%d",
)
_VISIBLE_DATE = re.compile(r"20\d{2}[.-]\d{2}[.-]\d{2}\s+\d{2}:\d{2}(?::\d{2})?")


@dataclass(frozen=True)
class DailyMediArticle:
    title: str
    url: str
    wr_id: str
    published_at: datetime


@dataclass(frozen=True)
class DailyMediPage:
    articles: Tuple[DailyMediArticle, ...]
    fingerprint: Tuple[str, ...]
    all_articles_older_than_cutoff: bool


def _allowed_article_url(href: str, list_url: str) -> Optional[Tuple[str, str]]:
    url = urljoin(list_url, href.strip())
    parsed = urlparse(url)
    if parsed.scheme != "https" or (parsed.hostname or "").lower() not in ALLOWED_HOSTS:
        return None
    if parsed.path.rstrip("/") != "/news/news_view.php":
        return None
    wr_ids = parse_qs(parsed.query).get("wr_id", [])
    if len(wr_ids) != 1 or not re.fullmatch(r"\d+", wr_ids[0]):
        return None
    return url, wr_ids[0]


def _parse_kst_datetime(value: str) -> Optional[datetime]:
    candidate = value.strip()
    for date_format in _DATE_FORMATS:
        try:
            return datetime.strptime(candidate, date_format).replace(tzinfo=KST).astimezone(timezone.utc)
        except ValueError:
            continue
    return None


def parse_article_page_date(html: str) -> Optional[datetime]:
    soup = BeautifulSoup(html, "html.parser")
    metadata = soup.select_one('meta[property="article:published_time"], meta[name="article:published_time"]')
    if metadata:
        raw_value = (metadata.get("content") or "").strip()
        if raw_value:
            try:
                parsed = datetime.fromisoformat(raw_value.replace("Z", "+00:00"))
                if parsed.tzinfo is None:
                    parsed = parsed.replace(tzinfo=KST)
                return parsed.astimezone(timezone.utc)
            except ValueError:
                pass

    time_tag = soup.select_one("time[datetime]")
    if time_tag:
        raw_value = (time_tag.get("datetime") or "").strip()
        if raw_value:
            try:
                parsed = datetime.fromisoformat(raw_value.replace("Z", "+00:00"))
                if parsed.tzinfo is None:
                    parsed = parsed.replace(tzinfo=KST)
                return parsed.astimezone(timezone.utc)
            except ValueError:
                pass

    visible_match = _VISIBLE_DATE.search(soup.get_text(" ", strip=True))
    return _parse_kst_datetime(visible_match.group(0)) if visible_match else None


def parse_list_page(
    html: str,
    list_url: str,
    *,
    cutoff: datetime,
    now: datetime,
    fetch_article_date: Optional[Callable[[str], Optional[datetime]]] = None,
) -> DailyMediPage:
    soup = BeautifulSoup(html, "html.parser")
    listing = soup.select_one(".listNews > ul.webzin.main2")
    if listing is None:
        raise ValueError("DailyMedi article listing markup not found")
    articles: List[DailyMediArticle] = []
    fingerprint: List[str] = []
    all_older = True

    for item in listing.select("li"):
        title_node = item.select_one(".stitle")
        anchor = item.select_one("a[href]")
        title = title_node.get_text(" ", strip=True) if title_node else ""
        link = _allowed_article_url((anchor.get("href") or "") if anchor else "", list_url)
        if not title or link is None:
            continue

        url, wr_id = link
        fingerprint.append(wr_id)
        date_node = item.select_one(".news_list_date")
        published_at = _parse_kst_datetime(date_node.get_text(" ", strip=True)) if date_node else None
        if published_at is None and fetch_article_date is not None:
            try:
                published_at = fetch_article_date(url)
            except Exception:
                published_at = None
        if published_at is None:
            published_at = now.astimezone(timezone.utc)
        if published_at >= cutoff:
            all_older = False
        articles.append(DailyMediArticle(title, url, wr_id, published_at))

    if not articles:
        all_older = False
    return DailyMediPage(tuple(articles), tuple(fingerprint), all_older)


def collect_recent_articles(
    fetch_list_page: Callable[[str], str],
    fetch_article_date: Callable[[str], Optional[datetime]],
    *,
    now: Optional[datetime] = None,
    sections: Tuple[str, ...] = SECTION_IDS,
    max_pages: int = MAX_PAGES_PER_SECTION,
) -> List[dict]:
    now = now or datetime.now(timezone.utc)
    if now.tzinfo is None:
        now = now.replace(tzinfo=timezone.utc)
    cutoff = now.astimezone(timezone.utc) - timedelta(days=7)
    articles_by_id: Dict[str, DailyMediArticle] = {}

    for section_id in sections:
        seen_pages: Set[Tuple[str, ...]] = set()
        for page_number in range(1, max_pages + 1):
            list_url = f"{LIST_URL}?ca_id={section_id}&page={page_number}"
            try:
                html = fetch_list_page(list_url)
            except TRANSIENT_ERRORS as error:
                if page_number == 1 or not articles_by_id:
                    raise
                print(
                    f"DailyMedi partial pagination: section={section_id} "
                    f"page={page_number} retained={len(articles_by_id)} "
                    f"error={type(error).__name__}"
                )
                break
            page = parse_list_page(
                html,
                list_url,
                cutoff=cutoff,
                now=now,
                fetch_article_date=fetch_article_date,
            )
            if not page.fingerprint or page.fingerprint in seen_pages:
                break
            seen_pages.add(page.fingerprint)

            for article in page.articles:
                if article.published_at >= cutoff and article.wr_id not in articles_by_id:
                    articles_by_id[article.wr_id] = article

            if page.all_articles_older_than_cutoff:
                break

    if not articles_by_id:
        raise ValueError("DailyMedi collection produced no recent valid articles")
    return [
        {
            "source": SOURCE_NAME,
            "title": article.title,
            "url": article.url,
            "published_date": article.published_at.isoformat(),
            "content_hash": get_content_hash(article.title + article.url),
            "status": "NEW",
        }
        for article in articles_by_id.values()
    ]


def _fetch_text(url: str) -> str:
    for attempt in range(1, len(RETRY_BACKOFFS) + 2):
        try:
            response = requests.get(
                url,
                headers={"User-Agent": "Mozilla/5.0 (compatible; MedicalBriefingBot/1.0)"},
                timeout=(5, 20),
                allow_redirects=True,
            )
            break
        except TRANSIENT_ERRORS as error:
            print(
                f"DailyMedi transient request failure: url={url} "
                f"attempt={attempt}/3 error={type(error).__name__}"
            )
            if attempt > len(RETRY_BACKOFFS):
                raise
            time.sleep(RETRY_BACKOFFS[attempt - 1])
    response.raise_for_status()
    final_url = urlparse(response.url)
    final_host = (final_url.hostname or "").lower()
    if final_url.scheme != "https" or final_host not in ALLOWED_HOSTS:
        raise ValueError(f"DailyMedi redirected outside the approved host list: {final_host}")
    return response.text


def _fetch_article_date(url: str) -> Optional[datetime]:
    import requests

    try:
        return parse_article_page_date(_fetch_text(url))
    except (requests.RequestException, ValueError):
        return None


def fetch_dailymedi_articles() -> List[dict]:
    print(f"DailyMedi HTML collection: sections={','.join(SECTION_IDS)} window_days=7")
    return collect_recent_articles(_fetch_text, _fetch_article_date)
