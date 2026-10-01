from datetime import datetime, timezone, timedelta
import atexit
import os
import time
from urllib.parse import urlparse
import re

import feedparser
import requests
from bs4 import BeautifulSoup
from dotenv import load_dotenv
from supabase import create_client, Client
from collector_sources.comwel import source_collection_diagnostics
from collector_sources.dailymedi import fetch_dailymedi_articles
from collector_sources.medical_press import is_valid_press_article
from collector_parsers import (
    get_content_hash,
    has_hira_target_board,
    is_valid_article_record,
    normalize_rss_entry,
    parse_hira_ssv_response,
    parse_kdca_press_release_html,
    parse_rss_entries,
)

load_dotenv()

url: str = os.environ.get("SUPABASE_URL")
key: str = os.environ.get("SUPABASE_KEY")
law_api_key: str = os.environ.get("LAW_API_KEY", "yhkimBriefing2026") # 사용자가 발급받은 키

supabase: Client = create_client(url, key)

def _response_text(response, *, allow_unknown_content_type=False):
    content_type = (response.headers.get("content-type") or "").lower()
    textual_type = (
        content_type.startswith("text/")
        or content_type.startswith("application/xml")
        or content_type.startswith("application/json")
        or "+xml" in content_type
        or "+json" in content_type
    )
    body = response.body()
    if not textual_type and not allow_unknown_content_type:
        return None
    if not textual_type and not body.lstrip().startswith((b"<", b"SSV:", b"Dataset:")):
        return None
    try:
        return body.decode("utf-8")
    except UnicodeDecodeError:
        return None


def _wait_for_target_response(page, state, timeout_ms=15000):
    deadline = time.monotonic() + timeout_ms / 1000
    while time.monotonic() < deadline:
        if state["error"]:
            raise ValueError(state["error"])
        if state["parsed"]:
            return
        page.wait_for_timeout(100)
    if state["error"]:
        raise ValueError(state["error"])
    raise TimeoutError("target API response readiness timeout")


def _goto_until_ready(page, url, state, timeout_ms=15000):
    try:
        page.goto(url, wait_until="domcontentloaded", timeout=timeout_ms)
    except Exception as error:
        if type(error).__name__ != "TimeoutError" or not state["parsed"]:
            raise
        print(f"navigation 완료 전 target response 확보: {type(error).__name__}")


def get_with_transient_retry(
    url: str,
    *,
    source_name: str,
    timeout: int,
    headers=None,
    verify: bool = True,
    allow_redirects: bool = True,
    sleep_fn=time.sleep,
):
    # 정부기관 사이트는 GitHub Actions 구간에서 일시적인 connect timeout이 종종 발생합니다.
    # 짧은 3회 재시도보다 충분한 간격을 둔 4회 시도가 실제 장애와 일시 장애를 더 잘 구분합니다.
    backoffs = (3, 8, 15)
    for attempt in range(1, 5):
        try:
            response = requests.get(
                url,
                headers=headers,
                timeout=timeout,
                verify=verify,
                allow_redirects=allow_redirects,
            )
            if attempt > 1:
                print(f"✅ Recovered after retry: source={source_name} attempt={attempt}/4")
            return response
        except (requests.exceptions.ConnectTimeout, requests.exceptions.ReadTimeout, requests.exceptions.ConnectionError) as error:
            if attempt == 4:
                raise
            delay = backoffs[attempt - 1]
            print(
                f"⚠️ Transient network error: source={source_name} "
                f"attempt={attempt}/4 retry_in={delay}s "
                f"error={type(error).__name__}"
            )
            sleep_fn(delay)
    raise RuntimeError("unreachable")


def validate_feed_redirects(response, rss_url: str) -> None:
    expected_host = urlparse(rss_url).hostname
    if not expected_host:
        raise ValueError(f"RSS URL host가 없습니다: {rss_url}")
    expected_host = expected_host.removeprefix("www.")
    redirect_urls = [history.url for history in response.history] + [response.url]
    for redirect_url in redirect_urls:
        redirect_host = urlparse(redirect_url).hostname
        if not redirect_host or redirect_host.removeprefix("www.") != expected_host:
            raise ValueError(
                f"RSS redirect가 공식 host를 벗어났습니다: {rss_url} -> {redirect_url}"
            )

collector_run_started_at = datetime.now(timezone.utc)
collector_run_summary = {
    "result": "FAILED",
    "collected_count": 0,
    "ai_output_count": 0,
    "db_attempted": 0,
    "db_succeeded": 0,
    "db_failed": 0,
    "source_health": {},
    "error_message": None,
}
collector_run_persisted = False


def persist_collector_run() -> None:
    global collector_run_persisted
    if collector_run_persisted:
        return

    safe_source_health = {
        name: {
            "count": health.get("count", 0),
            "status": health.get("status", "FAILED"),
            "reason": health.get("reason", ""),
        }
        for name, health in collector_run_summary["source_health"].items()
    }
    payload = {
        "started_at": collector_run_started_at.isoformat(),
        "finished_at": datetime.now(timezone.utc).isoformat(),
        **{key: value for key, value in collector_run_summary.items() if key != "source_health"},
        "source_health": safe_source_health,
    }
    try:
        supabase.table("collector_runs").insert(payload).execute()
        collector_run_persisted = True
        print("✅ collector_runs 실행 이력을 저장했습니다.")
    except Exception as error:
        print(f"⚠️ collector_runs 실행 이력 저장 실패: {error}")

# 1. RSS 파서 (복지부, 질병청, 식약처, 언론사)
def fetch_rss_feed(source_name: str, rss_url: str, is_press=False):
    print(f"🔄 RSS 수집: {source_name}")
    response = get_with_transient_retry(
        rss_url,
        source_name=source_name,
        headers={"User-Agent": "Mozilla/5.0"},
        timeout=20,
        allow_redirects=True,
    )
    response.raise_for_status()
    validate_feed_redirects(response, rss_url)
    content_type = response.headers.get("Content-Type", "").lower()
    if not response.content:
        raise ValueError(f"RSS 응답 본문이 비어 있습니다: {rss_url}")
    print(
        f"RSS 응답 ({source_name}): status={response.status_code} "
        f"content-type={content_type or '미지정'} final_url={response.url} "
        f"redirects={len(response.history)}"
    )

    feed = feedparser.parse(response.content)
    if feed.bozo and not feed.entries:
        raise ValueError(
            f"RSS 파싱 실패: url={response.url}, bozo_exception={feed.bozo_exception}"
        )
    if "html" in content_type and not feed.entries:
        raise ValueError(f"RSS가 아닌 HTML 응답입니다: content-type={content_type}, url={response.url}")
    if feed.bozo:
        print(f"⚠️ RSS 파싱 경고 ({source_name}): {feed.bozo_exception}")

    parsed = parse_rss_entries(
        feed.entries,
        response.url,
        source_name,
        is_press=is_press,
        press_filter=is_valid_press_article,
    )
    if parsed["invalid_entries"]:
        print(f"⚠️ RSS invalid entries skipped ({source_name}): {parsed['invalid_entries']}")

    if is_press:
        source_collection_diagnostics[source_name] = (
            f"feed={parsed['raw_entries']} recent={parsed['recent_entries']} "
            f"filtered={parsed['filtered_entries']}"
        )
    return parsed["articles"]

def fetch_kdca_press_releases():
    """KDCA RSS 장애 시 공식 보도자료 목록을 fallback으로 수집합니다."""
    source_name = "질병관리청 보도자료"
    list_url = "https://www.kdca.go.kr/bbs/kdca/42/artclList.do"
    try:
        return fetch_rss_feed(
            source_name,
            "https://www.kdca.go.kr/bbs/kdca/41/rssList.do?row=50",
            False,
        )
    except Exception as rss_error:
        print(f"⚠️ KDCA RSS 실패, 공식 목록 fallback 사용: {rss_error}")

    response = get_with_transient_retry(
        list_url,
        source_name=source_name,
        headers={"User-Agent": "Mozilla/5.0"},
        timeout=20,
        allow_redirects=True,
    )
    response.raise_for_status()
    parsed = parse_kdca_press_release_html(response.text, list_url)
    articles = parsed["articles"]
    print(
        f"KDCA fallback DOM: tbody_rows={parsed['rows']} "
        f"all_tr={parsed['all_rows']} links={parsed['links']}"
    )
    source_collection_diagnostics[source_name] = (
        f"fallback_rows={parsed['rows']} valid_recent={len(articles)}"
    )

    if not articles:
        raise ValueError(
            f"KDCA RSS 실패 후 공식 보도자료 fallback도 유효 article 0건: url={list_url}"
        )
    print(f"✅ KDCA 공식 목록 fallback 수집: {len(articles)}건")
    return articles


# 2. 대한병원협회 웹 스크래퍼 (BeautifulSoup)
def fetch_kha_notices():
    source_name = "대한병원협회 공지사항"
    print(f"🔄 크롤링 수집: {source_name}")
    articles_to_save = []
    
    try:
        # 병협 공지사항은 페이지당 10개, offset 방식으로 페이징
        for offset in [0, 10, 20]:
            url = f"https://www.kha.or.kr/kha_home/notice_list.do?article.offset={offset}&articleLimit=10"
            headers = {'User-Agent': 'Mozilla/5.0'}
            # SSL 인증서 오류 방지를 위해 verify=False 설정 (InsecureRequestWarning 무시)
            requests.packages.urllib3.disable_warnings(requests.packages.urllib3.exceptions.InsecureRequestWarning)
            response = get_with_transient_retry(
                url, source_name=source_name, headers=headers, timeout=10, verify=False
            )
            soup = BeautifulSoup(response.text, 'html.parser')
            
            rows = soup.select('div.tr')
            for row in rows:
                tb_03 = row.select_one('.tb_03 a')
                tb_05 = row.select_one('.tb_05')
                if tb_03 and tb_05:
                    title = tb_03.text.strip()
                    href = tb_03.get('href', '')
                    if href.startswith('?'):
                        import urllib.parse as urlparse
                        parsed = urlparse.urlparse(href)
                        qs = urlparse.parse_qs(parsed.query)
                        # offset 쿼리파라미터를 고정하여 URL 변동 방지 (DB 고유키 유지)
                        mode = qs.get('mode', [''])[0]
                        articleNo = qs.get('articleNo', [''])[0]
                        link = f"https://www.kha.or.kr/kha_home/notice_list.do?mode={mode}&articleNo={articleNo}"
                    elif href.startswith('/'):
                        link = f"https://www.kha.or.kr{href}"
                    else:
                        link = href
                    
                    date_str = tb_05.text.strip()
                    try:
                        dt = datetime.strptime(date_str, "%Y-%m-%d")
                        # KST 기준 오후 3시(15:00)로 세팅
                        dt = dt.replace(hour=15, minute=0, second=0)
                        kst = timezone(timedelta(hours=9))
                        dt = dt.replace(tzinfo=kst)
                        iso_date = dt.isoformat()
                    except ValueError:
                        iso_date = datetime.now(timezone.utc).isoformat()
                        
                    articles_to_save.append({
                        "source": source_name,
                        "title": title,
                        "url": link,
                        "published_date": iso_date,
                        "content_hash": get_content_hash(f"{title}_{date_str}"),
                        "status": "NEW"
                    })
    except Exception as e:
        print(f"크롤링 에러 ({source_name}): {e}")
        raise
        
    return articles_to_save

# 3. 국가법령정보센터 오픈 API
def fetch_law_api():
    source_name = "국가법령정보센터"
    print(f"🔄 오픈 API 수집: {source_name}")
    articles_to_save = []
    
    try:
        # 최근 제정/개정된 의료법 등을 검색
        url = f"https://www.law.go.kr/DRF/lawSearch.do?OC={law_api_key}&target=law&type=JSON&query=의료법"
        headers = {'Referer': 'https://medical-briefing-bot.vercel.app'} # Referer 검증 통과용
        response = get_with_transient_retry(
            url, source_name=source_name, headers=headers, timeout=10
        )
        if response.status_code != 200:
            raise ValueError(f"국가법령정보센터 API HTTP 오류: status={response.status_code}")
        data = response.json()
        # 데이터 추출 (LawSearch > law 객체 배열)
        # 여기서는 API가 작동한다는 전제하에 임시 데이터를 삽입합니다.
        if "LawSearch" in data and "law" in data["LawSearch"]:
            for law in data["LawSearch"]["law"]:
                articles_to_save.append({
                    "source": source_name,
                    "title": f"[법령] {law.get('법령명한글', '의료법')}",
                    "url": f"https://www.law.go.kr/LSW/lsInfoP.do?lsiSeq={law.get('법령일련번호')}",
                    "published_date": datetime.now(timezone.utc).isoformat(),
                    "content_hash": get_content_hash(law.get('법령일련번호', '0')),
                    "status": "NEW"
                })
        else:
            # API 파라미터나 키 오류 시 임시 데이터 반환 (화면 확인용)
            articles_to_save.append({
                "source": source_name,
                "title": "[최신개정] 의료법 시행령 일부개정령안",
                "url": "https://www.law.go.kr/법령/의료법시행령",
                "published_date": datetime.now(timezone.utc).isoformat(),
                "content_hash": get_content_hash("의료법시행령 일부개정령안"),
                "status": "NEW"
            })
    except Exception as e:
        print(f"API 에러 ({source_name}): {e}")
        raise
        
    return articles_to_save

import urllib3
urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)
import requests
from bs4 import BeautifulSoup

# 4. 건강보험심사평가원 공개 공지사항 스크래퍼
def fetch_hira_public_notices():
    source_name = "심사평가원 공지사항"
    print(f"🔄 크롤링 수집: {source_name}")
    articles_to_save = []
    try:
        headers = {'User-Agent': 'Mozilla/5.0'}
        for page in [1, 2, 3]:
            res = get_with_transient_retry(
                f'https://www.hira.or.kr/bbsDummy.do?pgmid=HIRAA020002000100&pageIndex={page}',
                source_name=source_name,
                headers=headers,
                verify=False,
                timeout=10,
            )
            soup = BeautifulSoup(res.text, 'html.parser')
            
            for tr in soup.select('table tbody tr'):
                tds = tr.select('td')
                if len(tds) >= 2:
                    a = tds[1].select_one('a')
                    if a:
                        title = a.text.strip().replace('\t', '').replace('\n', '')
                        href = a.get('href')
                        full_url = f'https://www.hira.or.kr/bbsDummy.do{href}'
                        # 날짜 추출 (tds[3] 예상)
                        pub_date_iso = datetime.now(timezone.utc).isoformat()
                        try:
                            if len(tds) >= 4:
                                date_str = tds[3].text.strip()
                                kst = timezone(timedelta(hours=9))
                                dt = datetime.strptime(date_str, "%Y-%m-%d").replace(tzinfo=kst)
                                pub_date_iso = dt.isoformat()
                        except:
                            pass
                        
                        articles_to_save.append({
                            "source": source_name,
                            "title": title,
                            "url": full_url,
                            "published_date": pub_date_iso,
                            "content_hash": get_content_hash(title),
                            "status": "NEW"
                        })
    except Exception as e:
        print(f"크롤링 에러 ({source_name}): {e}")
        raise
    return articles_to_save

# 5. 국민건강보험공단 공개 공지사항 스크래퍼

def fetch_hira_biz_notices():
    source_name = "심평원 업무포탈"
    print(f"🔄 크롤링 수집: {source_name}")
    articles_to_save = []
    
    try:
        from playwright.sync_api import sync_playwright
        import json
    except ImportError:
        raise RuntimeError("Playwright 라이브러리가 없습니다.")

    try:
        with sync_playwright() as p:
            browser = p.chromium.launch(headless=True)
            page = browser.new_page()
            readiness = {"parsed": False, "error": None}
            
            # API 응답 가로채기
            def handle_response(response):
                if 'biz.hira.or.kr' in response.url and '.ndo' in response.url:
                    try:
                        text = _response_text(response)
                        if text is None:
                            return
                        parsed_articles, has_board_dataset = parse_hira_ssv_response(text)
                        articles_to_save.extend(parsed_articles)
                        readiness["parsed"] = has_board_dataset
                    except Exception as e:
                        readiness["error"] = f"{source_name} target response parse failed: {e}"
                        print(f"응답 파싱 건너뜀 ({source_name}): {e}")

            page.on("response", handle_response)
            
            # 메인 접속 후 최초 공지사항 응답이 실제로 파싱될 때까지 기다립니다.
            # 자보알림방 클릭 전에 readiness를 초기화하지 않으면 메인 응답의
            # parsed=True가 남아 있어 클릭 이후 응답을 기다리지 않고 브라우저가
            # 종료될 수 있습니다.
            _goto_until_ready(page, 'https://biz.hira.or.kr/index.do', readiness)
            _wait_for_target_response(page, readiness, timeout_ms=15000)

            # 자보알림방은 별도의 네트워크 응답이므로 새 readiness로 기다립니다.
            readiness["parsed"] = False
            readiness["error"] = None
            before_count = len(articles_to_save)
            try:
                page.get_by_text('자보알림방', exact=True).first.click()
            except Exception as e:
                raise RuntimeError(f"자보알림방 클릭 실패: {e}") from e

            # 클릭 뒤 첫 dsBoard 응답이 공지사항일 수 있으므로, 실제 자보알림방
            # BBSMSTR(00000663) 레코드가 들어올 때까지 기다립니다.
            deadline = time.monotonic() + 20
            while time.monotonic() < deadline:
                if readiness["error"]:
                    raise ValueError(readiness["error"])
                if has_hira_target_board(articles_to_save[before_count:]):
                    break
                page.wait_for_timeout(100)
            else:
                raise RuntimeError("자보알림방 응답은 수신했지만 기대한 게시판 데이터가 없습니다.")

            browser.close()
    except Exception as e:
        print(f"크롤링 에러 ({source_name}): {e}")
        raise
        
    return articles_to_save


def fetch_nhis_public_notices():
    source_name = "건보공단 업무포탈"
    print(f"🔄 크롤링 수집: {source_name}")
    articles_to_save = []
    try:
        import requests
        import urllib3
        import re
        from datetime import datetime, timezone, timedelta
        urllib3.disable_warnings()
        
        # NHIS POST도 GET 수집기와 동일한 transient retry 정책을 적용합니다.
        backoffs = (3, 8, 15)
        last_error = None
        for attempt in range(1, 5):
            try:
                res = requests.post(
                    'https://medicare.nhis.or.kr/portal/main/getNoticeList.do',
                    json={},
                    verify=False,
                    timeout=20,
                    headers={'User-Agent': 'Mozilla/5.0'},
                )
                res.raise_for_status()
                if attempt > 1:
                    print(f"✅ Recovered after retry: source={source_name} attempt={attempt}/4")
                break
            except (requests.exceptions.ConnectTimeout, requests.exceptions.ReadTimeout, requests.exceptions.ConnectionError) as error:
                last_error = error
                if attempt == 4:
                    raise
                delay = backoffs[attempt - 1]
                print(
                    f"⚠️ Transient network error: source={source_name} "
                    f"attempt={attempt}/4 retry_in={delay}s error={type(error).__name__}"
                )
                time.sleep(delay)
        data = res.json()
        
        if 'data1' in data:
            for item in data['data1']:
                title = item.get('title', '')
                title_clean = re.sub(r'<[^>]+>', '', title).strip()
                date_str = item.get('sysRegDttm', '')
                artiId = item.get('brdCtsNo', item.get('artiId', ''))
                full_url = f"https://medicare.nhis.or.kr/portal/index.do?artiId={artiId}"
                
                pub_date_iso = datetime.now(timezone.utc).isoformat()
                try:
                    kst = timezone(timedelta(hours=9))
                    dt = datetime.strptime(date_str, "%Y.%m.%d").replace(tzinfo=kst)
                    pub_date_iso = dt.isoformat()
                except:
                    pass
                    
                articles_to_save.append({
                    "source": source_name,
                    "title": title_clean,
                    "url": full_url,
                    "published_date": pub_date_iso,
                    "content_hash": get_content_hash(title_clean),
                    "status": "NEW"
                })
                
        if 'data4' in data:
            for item in data['data4']:
                title = item.get('title', '')
                title_clean = re.sub(r'<[^>]+>', '', title).strip()
                date_str = item.get('sysRegDttm', '')
                artiId = item.get('brdCtsNo', item.get('artiId', ''))
                full_url = f"https://medicare.nhis.or.kr/portal/index.do?artiId={artiId}"
                
                pub_date_iso = datetime.now(timezone.utc).isoformat()
                try:
                    kst = timezone(timedelta(hours=9))
                    dt = datetime.strptime(date_str, "%Y.%m.%d").replace(tzinfo=kst)
                    pub_date_iso = dt.isoformat()
                except:
                    pass
                    
                articles_to_save.append({
                    "source": f"{source_name} (요양기관)",
                    "title": title_clean,
                    "url": full_url,
                    "published_date": pub_date_iso,
                    "content_hash": get_content_hash(title_clean),
                    "status": "NEW"
                })
                
    except Exception as e:
        print(f"크롤링 에러 ({source_name}): {e}")
        raise
    return articles_to_save


def track_states(new_articles: list, supabase: Client):
    """
    기존 DB 데이터와 비교하여 NEW, UPDATE, DELETED 상태를 판별합니다.
    """
    print("🔄 DB 기존 데이터와 비교하여 상태(NEW/UPDATE/DELETED)를 감지합니다...")
    
    # 1. DB에서 최근 7일치 기사 가져오기
    seven_days_ago = (datetime.now(timezone.utc) - timedelta(days=7)).isoformat()
    try:
        res = supabase.table('articles').select('*').gte('published_date', seven_days_ago).execute()
        db_articles = res.data
    except Exception as e:
        print(f"DB 데이터 조회 실패: {e}")
        db_articles = []

    # url을 키로 하는 딕셔너리로 변환
    db_dict = {a['url']: a for a in db_articles}
    
    final_articles_to_upsert = []
    
    # 이번에 수집(AI가 통합)한 기사들의 URL 목록
    new_urls = set()

    # 2. 신규(NEW) 및 수정(UPDATE) 판별
    for new_art in new_articles:
        url = new_art['url']
        new_urls.add(url)
        
        if url not in db_dict:
            new_art['status'] = 'NEW'
            final_articles_to_upsert.append(new_art)
        else:
            old_art = db_dict[url]
            category_changed = (
                'category' in new_art
                and old_art.get('category') != new_art.get('category')
            )
            keywords_changed = (
                'keywords' in new_art
                and old_art.get('keywords') != new_art.get('keywords')
            )
            is_merged_changed = (
                'is_merged' in new_art
                and old_art.get('is_merged') != new_art.get('is_merged')
            )
            if (old_art.get('content_hash') != new_art.get('content_hash')) or \
               is_merged_changed or category_changed or keywords_changed:
                new_art['status'] = 'UPDATE'
                final_articles_to_upsert.append(new_art)
            else:
                # 상태 변경 없음 (이미 DB에 똑같은 내용이 있음) -> Upsert 할 필요 없음
                pass

    # 3. 삭제(DELETED) 판별
    # 오늘 수집을 시도한 출처(Source) 목록
    fetched_sources = set(a['source'] for a in new_articles)
    
    for old_url, old_art in db_dict.items():
        # 오늘 긁어온 출처인데, 목록에 없다면 원본 사이트에서 지워진 것
        if old_art['source'] in fetched_sources and old_url not in new_urls:
            if old_art.get('status') != 'DELETED':
                old_art['status'] = 'DELETED'
                # 삭제 시간 기록 등 필요시 추가
                final_articles_to_upsert.append(old_art)

    return final_articles_to_upsert

def save_to_supabase(articles: list) -> dict[str, int]:
    attempted = len(articles)
    succeeded = 0
    failed = 0

    if not articles:
        print("✅ 새로 저장하거나 업데이트할 변경사항이 없습니다.")
        return {"attempted": 0, "succeeded": 0, "failed": 0}

    for article in articles:
        try:
            # upsert를 사용하여 기존 데이터 덮어쓰기 (url이 UNIQUE key라고 가정)
            supabase.table('articles').upsert(article, on_conflict='url').execute()
            succeeded += 1
        except Exception as e:
            failed += 1
            schema_fields = [
                field for field in ("is_merged", "related_links") if field in article
            ]
            schema_hint = (
                f" schema-sensitive fields present: {', '.join(schema_fields)}."
                if schema_fields else ""
            )
            print(
                f"⚠️ 저장 실패 [{article.get('title', 'N/A')}]"
                f"{schema_hint} error: {e}"
            )

    print(f"DB attempted: {attempted}")
    print(f"DB succeeded: {succeeded}")
    print(f"DB failed: {failed}")
    return {"attempted": attempted, "succeeded": succeeded, "failed": failed}



def fetch_hira_aq_notices():
    source_name = "심평원 e-평가"
    print(f"🔄 크롤링 수집: {source_name}")
    articles_to_save = []
    
    try:
        from playwright.sync_api import sync_playwright
        import xml.etree.ElementTree as ET
    except ImportError:
        raise RuntimeError("Playwright 라이브러리가 없습니다.")

    try:
        with sync_playwright() as p:
            browser = p.chromium.launch(headless=True)
            page = browser.new_page()
            readiness = {"parsed": False, "error": None}
            
            def handle_response(response):
                if 'selectPopupList.ndo' in response.url:
                    try:
                        text = _response_text(response, allow_unknown_content_type=True)
                        if text is None:
                            return
                        if 'dsList' in text and '<?xml' in text:
                            root = ET.fromstring(text)
                            found_dataset = False
                            for ds in root.findall('.//{http://www.nexacroplatform.com/platform/dataset}Dataset'):
                                if ds.attrib.get('id') == 'dsList':
                                    found_dataset = True
                                    for row in ds.findall('.//{http://www.nexacroplatform.com/platform/dataset}Row')[:15]:
                                        cols = {col.attrib.get('id'): col.text for col in row.findall('.//{http://www.nexacroplatform.com/platform/dataset}Col')}
                                        
                                        title = cols.get('brdTtl', '').strip()
                                        date_str = cols.get('regDt', '') # YYYY-MM-DD
                                        brdSno = cols.get('brdSno', '')
                                        
                                        if not title: continue
                                        
                                        pub_date_iso = datetime.now(timezone.utc).isoformat()
                                        if date_str:
                                            kst = timezone(timedelta(hours=9))
                                            try:
                                                dt = datetime.strptime(date_str, "%Y-%m-%d").replace(tzinfo=kst)
                                                pub_date_iso = dt.isoformat()
                                            except: pass
                                            
                                        articles_to_save.append({
                                            "source": f"{source_name} (평가알림방)",
                                            "title": title,
                                            "url": f"https://aq.hira.or.kr/hira_aq/index.jsp#brdSno={brdSno}",
                                            "published_date": pub_date_iso,
                                            "content_hash": get_content_hash(title),
                                            "status": "NEW"
                                        })
                            if found_dataset:
                                readiness["parsed"] = True
                    except Exception as e:
                        readiness["error"] = f"{source_name} target response parse failed: {e}"
                        
            page.on("response", handle_response)
            
            _goto_until_ready(page, 'https://aq.hira.or.kr/hira_aq/index.jsp', readiness)
            _wait_for_target_response(page, readiness, timeout_ms=15000)
            browser.close()
    except Exception as e:
        print(f"크롤링 에러 ({source_name}): {e}")
        raise
        
    return articles_to_save



def fetch_hurb_notices():
    source_name = "보건의료자원포탈"
    print(f"🔄 크롤링 수집: {source_name}")
    articles_to_save = []
    
    try:
        from playwright.sync_api import sync_playwright
        import xml.etree.ElementTree as ET
    except ImportError:
        raise RuntimeError("Playwright 라이브러리가 없습니다.")

    try:
        with sync_playwright() as p:
            browser = p.chromium.launch(headless=True)
            page = browser.new_page()
            readiness = {"parsed": False, "error": None}
            
            def handle_response(response):
                if 'selectPopupList.ndo' in response.url:
                    try:
                        text = _response_text(response, allow_unknown_content_type=True)
                        if text is None:
                            return
                        if 'dsResult' in text and '<?xml' in text:
                            root = ET.fromstring(text)
                            found_dataset = False
                            for ds in root.findall('.//{http://www.nexacroplatform.com/platform/dataset}Dataset'):
                                if ds.attrib.get('id') == 'dsResult':
                                    found_dataset = True
                                    for row in ds.findall('.//{http://www.nexacroplatform.com/platform/dataset}Row')[:15]:
                                        cols = {col.attrib.get('id'): col.text for col in row.findall('.//{http://www.nexacroplatform.com/platform/dataset}Col')}
                                        
                                        title = cols.get('teme', '').strip()
                                        date_str = cols.get('creDthms', '') # YYYY-MM-DD
                                        no = cols.get('no', '')
                                        
                                        if not title: continue
                                        
                                        pub_date_iso = datetime.now(timezone.utc).isoformat()
                                        if date_str:
                                            kst = timezone(timedelta(hours=9))
                                            try:
                                                dt = datetime.strptime(date_str, "%Y-%m-%d").replace(tzinfo=kst)
                                                pub_date_iso = dt.isoformat()
                                            except: pass
                                            
                                        articles_to_save.append({
                                            "source": source_name,
                                            "title": title,
                                            "url": f"https://www.hurb.or.kr/hira_sg/index.jsp?sso=ok#no={no}",
                                            "published_date": pub_date_iso,
                                            "content_hash": get_content_hash(title),
                                            "status": "NEW"
                                        })
                            if found_dataset:
                                readiness["parsed"] = True
                    except Exception as e:
                        readiness["error"] = f"{source_name} target response parse failed: {e}"
                        
            page.on("response", handle_response)
            
            _goto_until_ready(page, 'https://www.hurb.or.kr/hira_sg/index.jsp?sso=ok', readiness)
            _wait_for_target_response(page, readiness, timeout_ms=15000)
            browser.close()
    except Exception as e:
        print(f"크롤링 에러 ({source_name}): {e}")
        raise
        
    return articles_to_save


def fetch_mohw_legislation():
    source_name = "보건복지부 법령"
    print(f"🔄 크롤링 수집: {source_name}")
    articles_to_save = []
    try:
        from bs4 import BeautifulSoup
        import requests
        import urllib3
        from datetime import datetime, timezone, timedelta
        urllib3.disable_warnings()
        
        headers = {'User-Agent': 'Mozilla/5.0'}
        res = get_with_transient_retry(
            'https://www.mohw.go.kr/board.es?mid=a10409020000&bid=0026',
            source_name=source_name,
            headers=headers,
            verify=False,
            timeout=10,
        )
        soup = BeautifulSoup(res.text, 'html.parser')
        
        for tr in soup.select('tbody tr')[:15]:
            tds = tr.select('td')
            if len(tds) >= 4:
                a = tds[3].select_one('a')
                if not a and len(tds) >= 5:
                    for td in tds:
                        a_tag = td.select_one('a')
                        if a_tag and 'board.es' in a_tag.get('href', ''):
                            a = a_tag
                            break
                            
                if a:
                    title_text = a.text.strip().replace('새글', '').strip()
                    href = a.get('href')
                    full_url = f'https://www.mohw.go.kr{href}'
                    
                    date_str = tds[-2].text.strip()
                    
                    pub_date_iso = datetime.now(timezone.utc).isoformat()
                    try:
                        kst = timezone(timedelta(hours=9))
                        dt = datetime.strptime(date_str, "%Y-%m-%d").replace(tzinfo=kst)
                        pub_date_iso = dt.isoformat()
                    except:
                        pass
                        
                    articles_to_save.append({
                        "source": source_name,
                        "title": title_text,
                        "url": full_url,
                        "published_date": pub_date_iso,
                        "content_hash": get_content_hash(title_text),
                        "status": "NEW"
                    })
    except Exception as e:
        print(f"크롤링 에러 ({source_name}): {e}")
        raise
    return articles_to_save


if __name__ == "__main__":
    collector_run_started_at = datetime.now(timezone.utc)
    atexit.register(persist_collector_run)
    print("=== 브리핑 데이터 수집 봇 실행 (V4.3 - 상태 감지 완비) ===")
    
    total_articles = []
    source_health = {}

    def collect_source(name: str, collector) -> None:
        try:
            collected = collector()
            diagnostic = source_collection_diagnostics.get(name, "")
            source_health[name] = {
                "count": len(collected),
                "status": "OK",
                "reason": diagnostic if diagnostic else ("정상 0건" if not collected else ""),
            }
            total_articles.extend(collected)
        except Exception as e:
            source_health[name] = {
                "count": 0,
                "status": "FAILED",
                "reason": str(e),
            }
    
    # 1. RSS
    rss_sources = [
        {"name": "보건복지부 보도자료", "url": "https://www.mohw.go.kr/rss/board.es?mid=a10503000000&bid=0027&info", "is_press": False},
        {"name": "식품의약품안전처 보도자료", "url": "http://www.mfds.go.kr/www/rss/brd.do?brdId=ntc0021", "is_press": False},
        {"name": "청년의사", "url": "http://www.docdocdoc.co.kr/rss/allArticle.xml", "is_press": True},
        {"name": "의협신문", "url": "http://www.doctorsnews.co.kr/rss/allArticle.xml", "is_press": True},
        {"name": "메디게이트뉴스", "url": "https://news.google.com/rss/search?q=site:medigatenews.com&hl=ko&gl=KR&ceid=KR:ko", "is_press": True},
        {"name": "의학신문", "url": "https://cdn.bosa.co.kr/rss/gn_rss_allArticle.xml", "is_press": True},
        {"name": "보건신문", "url": "http://www.bokuennews.com/data/rss/news.xml", "is_press": True}
    ]
    for s in rss_sources:
        collect_source(
            s["name"],
            lambda s=s: fetch_rss_feed(s["name"], s["url"], s["is_press"]),
        )

    collect_source("데일리메디", fetch_dailymedi_articles)
        
    # 2. 크롤러
    collect_source("질병관리청 보도자료", fetch_kdca_press_releases)
    collect_source("대한병원협회 공지사항", fetch_kha_notices)
    collect_source("심사평가원 공지사항", fetch_hira_public_notices)
    collect_source("국민건강보험공단 공지사항", fetch_nhis_public_notices)
    collect_source("심평원 e-평가", fetch_hira_biz_notices)
    collect_source("심평원 e-평가 (평가알림방)", fetch_hira_aq_notices)
    collect_source("보건의료자원포탈", fetch_hurb_notices)
    collect_source("보건복지부 법령", fetch_mohw_legislation)

    # 3. 오픈 API
    collect_source("국가법령정보센터", fetch_law_api)
    collector_run_summary["source_health"] = source_health.copy()
    
    # 최종 저장 경계에서도 오류/placeholder 레코드를 차단합니다.
    # 개별 수집기의 검증이 누락되더라도 운영 UI까지 오염되지 않게 하는 2차 방어선입니다.
    rejected_articles = [a for a in total_articles if not is_valid_article_record(a)]
    if rejected_articles:
        print(f"⚠️ Invalid article records rejected before DB sync: {len(rejected_articles)}")
    processed_articles = [a for a in total_articles if is_valid_article_record(a)]
        
    # 5. 기존 DB와 비교하여 상태 감지 (NEW, UPDATE, DELETED)
    final_sync_articles = track_states(processed_articles, supabase)
    
    # DB 저장
    db_stats = save_to_supabase(final_sync_articles)
    failed_sources = [name for name, health in source_health.items() if health["status"] == "FAILED"]

    if db_stats["failed"] > 0:
        result = "FAILED"
    elif failed_sources:
        result = "DEGRADED"
    else:
        result = "SUCCESS"

    print("=== Collector Health Summary ===")
    for name, health in source_health.items():
        reason = f" reason={health['reason']}" if health["reason"] else ""
        print(
            f"{name}: collected count={health['count']} "
            f"status={health['status']}{reason}"
        )
    print(f"Collected: {len(total_articles)}")
    print(f"AI output: {len(processed_articles)}")
    print(f"DB attempted: {db_stats['attempted']}")
    print(f"DB succeeded: {db_stats['succeeded']}")
    print(f"DB failed: {db_stats['failed']}")
    print(f"RESULT: {result}")

    collector_run_summary = {
        "result": result,
        "collected_count": len(total_articles),
        "ai_output_count": len(processed_articles),
        "db_attempted": db_stats["attempted"],
        "db_succeeded": db_stats["succeeded"],
        "db_failed": db_stats["failed"],
        "source_health": source_health,
        "error_message": None,
    }
    persist_collector_run()

    if result == "FAILED":
        raise SystemExit(1)
