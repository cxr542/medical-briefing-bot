"""Read KDCA title-anchor calls as data. No JavaScript is executed."""
import re

from collector_detail_links import validated_source_detail_url

SPACE = r"[ \t\r\n]*"
CALL = re.compile(r"jf_viewArtcl" + SPACE + r"\(" + SPACE + r"([^()]*)\)" + SPACE + r";?")
LITERAL = re.compile(r"(['\"])([a-z0-9]+)\1")
ID = re.compile(r"[1-9][0-9]{0,17}")


def article_id_from_call(value, *, href=False):
    if not isinstance(value, str):
        return None
    value = value.strip(' \t\r\n')
    if href:
        if not value.startswith('javascript:'):
            return None
        value = value[len('javascript:'):].strip(' \t\r\n')
    match = CALL.fullmatch(value)
    if match is None:
        return None
    arguments = match.group(1).split(',')
    if len(arguments) != 3:
        return None
    literals = [LITERAL.fullmatch(arg.strip(' \t\r\n')) for arg in arguments]
    if any(arg is None for arg in literals):
        return None
    institution, board, article_id = [arg.group(2) for arg in literals]
    return article_id if institution == 'kdca' and board == '42' and ID.fullmatch(article_id) else None


def title_anchor_detail_url(row, title_link, article, *, list_url):
    if list_url != "https://www.kdca.go.kr/bbs/kdca/42/artclList.do":
        return None
    if title_link is None or title_link.find_parent('tr') is not row:
        return None
    title = re.sub(r'\s*새글\s*$', '', title_link.get_text(' ', strip=True)).strip()
    if title != article.get('title'):
        return None
    # Never borrow a call from another anchor, nested row or neighboring item.
    for other in row.select('a'):
        if other is not title_link and other.find_parent('tr') is row:
            if any('jf_viewArtcl' in (other.get(attr) or '') for attr in ('href', 'onclick')):
                return None
    href = (title_link.get('href') or '').strip(' \t\r\n')
    onclick = (title_link.get('onclick') or '').strip(' \t\r\n')
    ids = []
    if href.startswith('javascript:'):
        parsed = article_id_from_call(href, href=True)
        if parsed is None:
            return None
        ids.append(parsed)
    elif href not in ('', '#'):
        # Existing direct/external href identity handling belongs to the baseline
        # parser, not this optional extraction policy.
        return None
    if onclick:
        parsed = article_id_from_call(onclick)
        if parsed is None:
            return None
        ids.append(parsed)
    if not ids or len(set(ids)) != 1:
        return None
    detail = f'https://www.kdca.go.kr/bbs/kdca/42/{ids[0]}/artclView.do'
    return validated_source_detail_url({**article, 'source_detail_url': detail})


def suppress_ambiguous_details(articles):
    titles = {}
    details = {}
    for article in articles:
        titles.setdefault(article['title'], []).append(article)
        if article.get('source_detail_url'):
            details.setdefault(article['source_detail_url'], []).append(article)
    for group in list(titles.values()) + list(details.values()):
        if len(group) > 1:
            for article in group:
                article.pop('source_detail_url', None)
