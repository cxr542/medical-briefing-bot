from datetime import datetime, timedelta, timezone
from hashlib import sha256
from urllib.parse import quote, urljoin, urlparse
import re

from bs4 import BeautifulSoup


KST = timezone(timedelta(hours=9))
RSS_INVALID_ENTRIES_ERROR = "RSS 유효 article entry가 없습니다"


def get_content_hash(text: str) -> str:
    return sha256(text.encode("utf-8")).hexdigest()


def normalize_rss_entry(entry, feed_url: str):
    raw_title = entry.get("title")
    raw_link = entry.get("link")
    if not isinstance(raw_title, str) or not isinstance(raw_link, str):
        return None
    title = raw_title.strip()
    raw_link = raw_link.strip()
    if not title or not raw_link:
        return None
    if re.search(r"unsupportable\s+rss|rss\s+not\s+supported", title, re.IGNORECASE):
        return None

    link = urljoin(feed_url, raw_link)
    parsed_link = urlparse(link)
    if parsed_link.scheme not in {"http", "https"} or not parsed_link.netloc:
        return None
    return title, link


def is_valid_article_record(article: dict) -> bool:
    title = str(article.get("title") or "").strip()
    url = str(article.get("url") or "").strip()
    if not title or not url:
        return False
    if re.search(r"unsupportable\s+rss|rss\s+not\s+supported", title, re.IGNORECASE):
        return False
    parsed_url = urlparse(url)
    return parsed_url.scheme in {"http", "https"} and bool(parsed_url.netloc)


def parse_rss_entries(
    entries,
    feed_url: str,
    source_name: str,
    *,
    now=None,
    is_press=False,
    press_filter=None,
):
    now = now or datetime.now(timezone.utc)
    if now.tzinfo is None:
        now = now.replace(tzinfo=timezone.utc)
    recent_since = now.astimezone(timezone.utc) - timedelta(days=7)
    articles = []
    recent_count = 0
    filtered_count = 0
    valid_entry_count = 0
    invalid_entry_count = 0

    for entry in entries:
        normalized_entry = normalize_rss_entry(entry, feed_url)
        if normalized_entry is None:
            invalid_entry_count += 1
            continue
        valid_entry_count += 1
        title, link = normalized_entry

        pub_date = now.astimezone(timezone.utc)
        published_parsed = entry.get("published_parsed")
        if published_parsed:
            pub_date = datetime(*published_parsed[:6], tzinfo=timezone.utc)
        if pub_date < recent_since:
            continue

        recent_count += 1
        if is_press and press_filter and not press_filter(title):
            continue
        filtered_count += 1
        articles.append({
            "source": source_name,
            "title": title,
            "url": link,
            "published_date": pub_date.isoformat(),
            "content_hash": get_content_hash(title + link),
            "status": "NEW",
        })

    if entries and valid_entry_count == 0:
        raise ValueError(
            f"{RSS_INVALID_ENTRIES_ERROR}: url={feed_url}, "
            f"raw_entries={len(entries)}, invalid_entries={invalid_entry_count}"
        )
    return {
        "articles": articles,
        "raw_entries": len(entries),
        "valid_entries": valid_entry_count,
        "invalid_entries": invalid_entry_count,
        "recent_entries": recent_count,
        "filtered_entries": filtered_count,
    }


def parse_kdca_press_release_html(html: str, list_url: str, *, now=None):
    now = now or datetime.now(timezone.utc)
    if now.tzinfo is None:
        now = now.replace(tzinfo=timezone.utc)
    seven_days_ago = now.astimezone(timezone.utc) - timedelta(days=7)
    soup = BeautifulSoup(html, "html.parser")
    rows = soup.select("tbody tr")
    if not rows:
        rows = [
            row for row in soup.select("tr")
            if re.search(r"20\d{2}[.-]\d{2}[.-]\d{2}", row.get_text(" ", strip=True))
        ]

    articles = []
    for row in rows:
        cells = row.select("td")
        row_text = row.get_text(" ", strip=True)
        date_match = re.search(r"20\d{2}[.-]\d{2}[.-]\d{2}", row_text)
        if not date_match:
            continue
        title_link = None
        for candidate in row.select("a"):
            candidate_text = candidate.get_text(" ", strip=True)
            if candidate_text and candidate_text not in {"첨부파일", "새글"}:
                title_link = candidate
                break
        title = title_link.get_text(" ", strip=True) if title_link else ""
        if not title and len(cells) >= 2:
            title = cells[1].get_text(" ", strip=True)
        title = re.sub(r"\s*새글\s*$", "", title).strip()
        if not title:
            continue

        href = (title_link.get("href") or "").strip() if title_link else ""
        onclick = (title_link.get("onclick") or "").strip() if title_link else ""
        id_match = re.search(r"/42/(\d+)/artclView\.do", href)
        if not id_match:
            id_match = re.search(r"(?:artclSeq|artclNo|articleNo)[^0-9]*(\d+)", href + " " + onclick, re.I)
        if not id_match:
            id_match = re.search(r"['\"](\d{4,})['\"]", onclick)
        if id_match:
            article_url = f"https://www.kdca.go.kr/bbs/kdca/42/{id_match.group(1)}/artclView.do"
        elif href and not href.lower().startswith(("javascript", "#")):
            article_url = urljoin(list_url, href)
        else:
            seq_text = cells[0].get_text(" ", strip=True) if cells else ""
            if not re.fullmatch(r"\d+", seq_text):
                continue
            article_url = f"{list_url}?page=1&srchColumn=title&srchWrd={quote(title)}"

        try:
            pub_date = datetime.strptime(
                date_match.group(0).replace(".", "-"), "%Y-%m-%d"
            ).replace(tzinfo=KST).astimezone(timezone.utc)
        except ValueError:
            continue
        if pub_date < seven_days_ago:
            continue
        article = {
            "source": "질병관리청 보도자료",
            "title": title,
            "url": article_url,
            "published_date": pub_date.isoformat(),
            "content_hash": get_content_hash(title + article_url),
            "status": "NEW",
        }
        if is_valid_article_record(article):
            articles.append(article)
    return {
        "articles": articles,
        "rows": len(rows),
        "all_rows": len(soup.select("tr")),
        "links": len(soup.select("a")),
    }


def parse_hira_ssv_response(text: str, *, now=None):
    if "Dataset:dsBoard" not in text:
        return [], False
    start_idx = text.find("Dataset:dsBoard")
    ds_board_text = text[start_idx:]
    next_ds_idx = ds_board_text.find("Dataset:", 10)
    if next_ds_idx != -1:
        ds_board_text = ds_board_text[:next_ds_idx]

    now = now or datetime.now(timezone.utc)
    if now.tzinfo is None:
        now = now.replace(tzinfo=timezone.utc)
    articles = []
    for row in ds_board_text.split("\x1e"):
        cols = row.split("\x1f")
        if len(cols) < 6 or "BBSMSTR" not in cols[1]:
            continue
        item_id = cols[2].strip()
        title = cols[3].strip()
        date_str = cols[5].strip()[:8]
        pub_date_iso = now.astimezone(timezone.utc).isoformat()
        if len(date_str) == 8:
            dt = datetime.strptime(date_str, "%Y%m%d").replace(tzinfo=KST)
            pub_date_iso = dt.isoformat()

        source = "심평원 업무포탈"
        if "00000663" in cols[1]:
            source = f"{source} (자보알림방)"
        else:
            source = f"{source} (공지사항)"
        article_url = (
            "http://biz.hira.or.kr/indexS.ndo?PROGRAM_ID=MP00000616&"
            f"PROGRAM_PARAM=nttId=={item_id}"
        )
        articles.append({
            "source": source,
            "title": title,
            "url": article_url,
            "published_date": pub_date_iso,
            "content_hash": get_content_hash(title),
            "status": "NEW",
        })
    return articles, True


def has_hira_target_board(articles):
    return any(
        article.get("source") == "심평원 업무포탈 (자보알림방)"
        for article in articles
    )
