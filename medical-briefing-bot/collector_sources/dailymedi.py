from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
import re
import time
from typing import Callable, Dict, List, Optional, Set, Tuple, TypedDict
from urllib.parse import parse_qs, urljoin, urlparse

from bs4 import BeautifulSoup
from bs4.element import Tag
import requests

from collector_parsers import get_content_hash


SOURCE_NAME = "데일리메디"
LIST_URL = "https://www.dailymedi.com/news/news_list.php"
SECTION_IDS = ("22", "21", "31")
MAX_PAGES_PER_SECTION = 13
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
    listing_item_count: int
    unresolved_date_count: int = 0


class DailyMediArticleRecord(TypedDict):
    source: str
    title: str
    url: str
    published_date: str
    content_hash: str
    status: str


@dataclass(frozen=True)
class DailyMediCollection:
    articles: Tuple[DailyMediArticleRecord, ...]
    complete: bool
    reason_code: Optional[str]


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


def _medi_box_article_url(
    href: str,
    list_url: str,
    section_id: str,
) -> Optional[Tuple[str, str]]:
    link = _allowed_article_url(href, list_url)
    if link is None:
        return None
    url, wr_id = link
    ca_ids = parse_qs(urlparse(url).query).get("ca_id", [])
    if len(ca_ids) != 1 or ca_ids[0] != section_id:
        return None
    return url, wr_id


def _listing_for_section(soup: BeautifulSoup, section_id: str) -> Optional[Tag]:
    if section_id in ("21", "31"):
        return soup.select_one(".listNews.mediBox > ul")
    return soup.select_one(".listNews > ul.webzin.main2")


def _article_title_marker_found(soup: BeautifulSoup, section_id: str) -> bool:
    if section_id in ("21", "31"):
        return soup.select_one(".listNews.mediBox > ul > li > .subject.ml_subject > a[href]") is not None
    return soup.select_one(".listNews > ul.webzin.main2 .stitle") is not None


def _section_id_from_url(list_url: str) -> str:
    section_ids = parse_qs(urlparse(list_url).query).get("ca_id", [])
    return section_ids[0] if len(section_ids) == 1 else ""


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
    section_id = _section_id_from_url(list_url)
    is_medi_box = section_id in ("21", "31")
    listing = _listing_for_section(soup, section_id)
    if listing is None:
        raise ValueError("DailyMedi article listing markup not found")
    articles: List[DailyMediArticle] = []
    fingerprint: List[str] = []
    all_older = True
    unresolved_date_count = 0

    for item in listing.select("li"):
        if is_medi_box:
            anchor = item.select_one(".subject.ml_subject > a[href]")
            title = anchor.get_text(" ", strip=True) if anchor else ""
            link = _medi_box_article_url(
                (anchor.get("href") or "") if anchor else "",
                list_url,
                section_id,
            )
        else:
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
            if is_medi_box:
                unresolved_date_count += 1
                all_older = False
                continue
            published_at = now.astimezone(timezone.utc)
        if published_at >= cutoff:
            all_older = False
        articles.append(DailyMediArticle(title, url, wr_id, published_at))

    if not articles:
        all_older = False
    return DailyMediPage(
        tuple(articles),
        tuple(fingerprint),
        all_older,
        len(listing.select("li")),
        unresolved_date_count,
    )


def collect_recent_articles(
    fetch_list_page: Callable[[str], str],
    fetch_article_date: Callable[[str], Optional[datetime]],
    *,
    now: Optional[datetime] = None,
    sections: Tuple[str, ...] = SECTION_IDS,
    max_pages: int = MAX_PAGES_PER_SECTION,
) -> DailyMediCollection:
    now = now or datetime.now(timezone.utc)
    if now.tzinfo is None:
        now = now.replace(tzinfo=timezone.utc)
    cutoff = now.astimezone(timezone.utc) - timedelta(days=7)
    articles_by_id: Dict[str, DailyMediArticle] = {}
    def make_result(complete: bool, reason_code: Optional[str]) -> DailyMediCollection:
        records = tuple(
            {
                "source": SOURCE_NAME,
                "title": article.title,
                "url": article.url,
                "published_date": article.published_at.isoformat(),
                "content_hash": get_content_hash(article.title + article.url),
                "status": "NEW",
            }
            for article in articles_by_id.values()
        )
        return DailyMediCollection(records, complete, reason_code)

    def make_partial(section_id: str, page_number: int, reason_code: str) -> DailyMediCollection:
        print(
            f"DailyMedi incomplete snapshot: section={section_id} page={page_number} "
            f"retained={len(articles_by_id)} reason={reason_code}"
        )
        return make_result(False, reason_code)

    for section_id in sections:
        seen_pages: Set[Tuple[str, ...]] = set()
        section_terminated = False
        for page_number in range(1, max_pages + 1):
            list_url = f"{LIST_URL}?ca_id={section_id}&page={page_number}"
            try:
                html = fetch_list_page(list_url)
            except requests.RequestException as error:
                return make_partial(section_id, page_number, f"list-request-{type(error).__name__}")
            except ValueError:
                return make_partial(section_id, page_number, "list-request-validation-failed")

            try:
                page = parse_list_page(
                    html,
                    list_url,
                    cutoff=cutoff,
                    now=now,
                    fetch_article_date=fetch_article_date,
                )
            except ValueError:
                return make_partial(section_id, page_number, "listing-markup-invalid")

            if not page.fingerprint:
                if page.listing_item_count:
                    return make_partial(section_id, page_number, "listing-has-no-valid-article-ids")
                section_terminated = True
                break
            if page.fingerprint in seen_pages:
                return make_partial(section_id, page_number, "repeated-list-page")
            seen_pages.add(page.fingerprint)

            for article in page.articles:
                if article.published_at >= cutoff and article.wr_id not in articles_by_id:
                    articles_by_id[article.wr_id] = article

            if page.unresolved_date_count:
                return make_partial(section_id, page_number, "article-date-unavailable")

            if page.all_articles_older_than_cutoff:
                section_terminated = True
                break
        if not section_terminated:
            return make_partial(section_id, max_pages, "maximum-pages-reached")

    if not articles_by_id:
        return make_result(False, "no-recent-valid-articles")
    return make_result(True, None)


def _fetch_text(url: str) -> str:
    is_listing_request = urlparse(url).path == urlparse(LIST_URL).path
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
    try:
        response.raise_for_status()
    except requests.HTTPError:
        if is_listing_request:
            _log_listing_diagnostic(url, response, attempt, "http-status-error", response.text)
        raise

    final_url = urlparse(response.url)
    final_host = (final_url.hostname or "").lower()
    text = response.text
    if is_listing_request:
        soup = BeautifulSoup(text, "html.parser")
        has_expected_list = _listing_for_section(soup, _section_id_from_url(url)) is not None
        if not has_expected_list:
            _log_listing_diagnostic(url, response, attempt, "missing-listing-selector", text)
    if final_url.scheme != "https" or final_host not in ALLOWED_HOSTS:
        if is_listing_request:
            _log_listing_diagnostic(url, response, attempt, "redirect-host-not-allowed", text)
        raise ValueError(f"DailyMedi redirected outside the approved host list: {final_host}")
    return text


def _log_listing_diagnostic(url: str, response, attempt: int, classification: str, text: str) -> None:
    query = parse_qs(urlparse(url).query)
    section_id = query.get("ca_id", ["unknown"])[0]
    page_number = query.get("page", ["unknown"])[0]
    if not section_id.isdecimal():
        section_id = "unknown"
    if not page_number.isdecimal():
        page_number = "unknown"

    final_url = urlparse(response.url)
    final_host = (final_url.hostname or "unknown").lower()
    final_path = final_url.path[:160]
    final_url_safe = (
        f"{final_url.scheme}://{final_host}{final_path}"
        if final_url.scheme in ("http", "https")
        else "unknown"
    )
    content_type = response.headers.get("content-type", "unknown").split(";", 1)[0]
    content_type = re.sub(r"[^A-Za-z0-9.+/-]", "", content_type)[:80] or "unknown"
    soup = BeautifulSoup(text, "html.parser")
    has_list_container = soup.select_one(".listNews") is not None
    has_expected_list = _listing_for_section(soup, section_id) is not None
    has_article_title_marker = _article_title_marker_found(soup, section_id)
    print(
        f"DailyMedi listing diagnostic: request_url={LIST_URL}?ca_id={section_id}&page={page_number} "
        f"final_url={final_url_safe} status={response.status_code} content_type={content_type} "
        f"response_bytes={len(response.content)} response_chars={len(text)} "
        f"redirects={len(response.history)} attempt={attempt} "
        f"marker_list_container={str(has_list_container).lower()} "
        f"marker_expected_list={str(has_expected_list).lower()} "
        f"marker_article_title={str(has_article_title_marker).lower()} classification={classification}"
    )


def _fetch_article_date(url: str) -> Optional[datetime]:
    import requests

    try:
        return parse_article_page_date(_fetch_text(url))
    except (requests.RequestException, ValueError):
        return None


def fetch_dailymedi_articles() -> DailyMediCollection:
    print(f"DailyMedi HTML collection: sections={','.join(SECTION_IDS)} window_days=7")
    return collect_recent_articles(_fetch_text, _fetch_article_date)
