# Frozen main 93d42d2 parser baseline, loaded offline.
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
