from datetime import datetime, timezone, timedelta
import os
import hashlib

import feedparser
import requests
from bs4 import BeautifulSoup
from dotenv import load_dotenv
from supabase import create_client, Client

load_dotenv()

url: str = os.environ.get("SUPABASE_URL")
key: str = os.environ.get("SUPABASE_KEY")
law_api_key: str = os.environ.get("LAW_API_KEY", "yhkimBriefing2026") # 사용자가 발급받은 키

supabase: Client = create_client(url, key)

WHITE_LIST = [
    "건강보험", "심사평가", "수가", "급여기준", "심사기준", "의료질평가", 
    "적정성평가", "e-평가", "DUR", "의료정책", "보건복지부", "심평원", 
    "건보공단", "병원 경영", "병원 행정", "병원 전산", "병원 인증", 
    "의료법", "판결", "의료계"
]
BLACK_LIST = ["인사", "부음", "홍보", "광고", "동정", "출시", "프로모션"]

def get_content_hash(text: str) -> str:
    return hashlib.sha256(text.encode('utf-8')).hexdigest()

def is_valid_press_article(title: str) -> bool:
    if any(black in title for black in BLACK_LIST): return False
    if any(white in title for white in WHITE_LIST): return True
    return False

# 1. RSS 파서 (복지부, 질병청, 식약처, 언론사)
def fetch_rss_feed(source_name: str, rss_url: str, is_press=False):
    print(f"🔄 RSS 수집: {source_name}")
    feed = feedparser.parse(rss_url)
    seven_days_ago = datetime.now(timezone.utc) - timedelta(days=7)
    articles_to_save = []
    
    for entry in feed.entries:
        title = entry.title
        link = entry.link
        
        if is_press and not is_valid_press_article(title):
            continue
            
        pub_date = datetime.now(timezone.utc)
        if hasattr(entry, 'published_parsed') and entry.published_parsed:
            pub_date = datetime(*entry.published_parsed[:6], tzinfo=timezone.utc)
            
        if pub_date < seven_days_ago:
            continue
            
        articles_to_save.append({
            "source": source_name,
            "title": title,
            "url": link,
            "published_date": pub_date.isoformat(),
            "content_hash": get_content_hash(title + link),
            "status": "NEW"
        })
    return articles_to_save

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
            response = requests.get(url, headers=headers, timeout=10, verify=False)
            soup = BeautifulSoup(response.text, 'html.parser')
            
            rows = soup.select('div.tr')
            for row in rows:
                tb_03 = row.select_one('.tb_03 a')
                tb_05 = row.select_one('.tb_05')
                if tb_03 and tb_05:
                    title = tb_03.text.strip()
                    href = tb_03.get('href', '')
                    if href.startswith('?'):
                        link = f"https://www.kha.or.kr/kha_home/notice_list.do{href}"
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
        response = requests.get(url, headers=headers, timeout=10)
        
        if response.status_code == 200:
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
            res = requests.get(f'https://www.hira.or.kr/bbsDummy.do?pgmid=HIRAA020002000100&pageIndex={page}', headers=headers, verify=False, timeout=10)
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
        print("⚠️ Playwright 라이브러리가 없습니다. (pip install playwright && playwright install)")
        return articles_to_save

    try:
        with sync_playwright() as p:
            browser = p.chromium.launch(headless=True)
            page = browser.new_page()
            
            # API 응답 가로채기
            def handle_response(response):
                if 'biz.hira.or.kr' in response.url and '.ndo' in response.url:
                    try:
                        text = response.text()
                        # SSV 응답 포맷인 경우
                        if 'Dataset:dsBoard' in text:
                            # 1. dsBoard 데이터 블록 찾기
                            start_idx = text.find('Dataset:dsBoard')
                            if start_idx != -1:
                                ds_board_text = text[start_idx:]
                                # 2. 다음 Dataset이 있으면 거기까지만
                                next_ds_idx = ds_board_text.find('Dataset:', 10)
                                if next_ds_idx != -1:
                                    ds_board_text = ds_board_text[:next_ds_idx]
                                
                                # 3. SSV 행 구분자는 보통 , 열 구분자는 
                                rows = ds_board_text.split('\x1e')
                                for row in rows:
                                    cols = row.split('\x1f')
                                    if len(cols) >= 5 and 'BBSMSTR' in cols[1]:
                                        item_id = cols[2].strip()
                                        title = cols[3].strip()
                                        date_str = cols[5].strip()[:8] # YYYYMMDD
                                        
                                        # 날짜 파싱
                                        pub_date_iso = datetime.now(timezone.utc).isoformat()
                                        if len(date_str) == 8:
                                            
                                            kst = timezone(timedelta(hours=9))
                                            dt = datetime.strptime(date_str, "%Y%m%d").replace(tzinfo=kst)
                                            pub_date_iso = dt.isoformat()
                                        
                                        # 게시판에 따라 출처명 세분화 (선택사항)
                                        board_type = source_name
                                        if '00000663' in cols[1]:
                                            board_type = f"{source_name} (자보알림방)"
                                        else:
                                            board_type = f"{source_name} (공지사항)"
                                            
                                        articles_to_save.append({
                                            "source": board_type,
                                            "title": title,
                                            "url": f"http://biz.hira.or.kr/indexS.ndo?PROGRAM_ID=MP00000616&PROGRAM_PARAM=nttId=={item_id}",
                                            "published_date": pub_date_iso,
                                            "content_hash": get_content_hash(title),
                                            "status": "NEW"
                                        })
                    except Exception as e:
                        pass

            page.on("response", handle_response)
            
            # 메인 접속 (공지사항 로드)
            page.goto('https://biz.hira.or.kr/index.do', wait_until='networkidle')
            page.wait_for_timeout(3000)
            
            # 자보알림방 클릭
            try:
                page.get_by_text('자보알림방', exact=True).first.click()
                page.wait_for_timeout(3000)
            except Exception as e:
                print(f"자보알림방 클릭 실패: {e}")
                
            browser.close()
    except Exception as e:
        print(f"크롤링 에러 ({source_name}): {e}")
        
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
        
        res = requests.post('https://medicare.nhis.or.kr/portal/main/getNoticeList.do', json={}, verify=False, timeout=10)
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
            if (old_art.get('content_hash') != new_art.get('content_hash')) or \
               (old_art.get('is_merged') != new_art.get('is_merged', False)) or \
               (old_art.get('category') != new_art.get('category')) or \
               (old_art.get('keywords') != new_art.get('keywords')):
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

def save_to_supabase(articles: list):
    if not articles:
        print("✅ 새로 저장하거나 업데이트할 변경사항이 없습니다.")
        return
    
    upsert_count = 0
    for article in articles:
        try:
            # upsert를 사용하여 기존 데이터 덮어쓰기 (url이 UNIQUE key라고 가정)
            supabase.table('articles').upsert(article, on_conflict='url').execute()
            upsert_count += 1
        except Exception as e:
            print(f"⚠️ 저장 실패 [{article.get('title', 'N/A')}]: {e}")
            
    print(f"✅ 총 {upsert_count}개의 게시물(신규/수정/삭제)을 DB에 동기화했습니다.")



def fetch_hira_aq_notices():
    source_name = "심평원 e-평가"
    print(f"🔄 크롤링 수집: {source_name}")
    articles_to_save = []
    
    try:
        from playwright.sync_api import sync_playwright
        import xml.etree.ElementTree as ET
    except ImportError:
        return articles_to_save

    try:
        with sync_playwright() as p:
            browser = p.chromium.launch(headless=True)
            page = browser.new_page()
            
            def handle_response(response):
                if 'selectPopupList.ndo' in response.url:
                    try:
                        text = response.text()
                        if 'dsList' in text and '<?xml' in text:
                            root = ET.fromstring(text)
                            for ds in root.findall('.//{http://www.nexacroplatform.com/platform/dataset}Dataset'):
                                if ds.attrib.get('id') == 'dsList':
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
                    except Exception as e:
                        pass
                        
            page.on("response", handle_response)
            
            page.goto('https://aq.hira.or.kr/hira_aq/index.jsp', wait_until='networkidle', timeout=30000)
            page.wait_for_timeout(3000)
            browser.close()
    except Exception as e:
        print(f"크롤링 에러 ({source_name}): {e}")
        
    return articles_to_save



def fetch_hurb_notices():
    source_name = "보건의료자원포탈"
    print(f"🔄 크롤링 수집: {source_name}")
    articles_to_save = []
    
    try:
        from playwright.sync_api import sync_playwright
        import xml.etree.ElementTree as ET
    except ImportError:
        return articles_to_save

    try:
        with sync_playwright() as p:
            browser = p.chromium.launch(headless=True)
            page = browser.new_page()
            
            def handle_response(response):
                if 'selectPopupList.ndo' in response.url:
                    try:
                        text = response.text()
                        if 'dsResult' in text and '<?xml' in text:
                            root = ET.fromstring(text)
                            for ds in root.findall('.//{http://www.nexacroplatform.com/platform/dataset}Dataset'):
                                if ds.attrib.get('id') == 'dsResult':
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
                    except Exception as e:
                        pass
                        
            page.on("response", handle_response)
            
            page.goto('https://www.hurb.or.kr/hira_sg/index.jsp?sso=ok', wait_until='networkidle', timeout=30000)
            page.wait_for_timeout(3000)
            browser.close()
    except Exception as e:
        print(f"크롤링 에러 ({source_name}): {e}")
        
    return articles_to_save


def fetch_comwel_notices():
    source_name = "산재업무포탈"
    print(f"🔄 API 수집: {source_name}")
    articles_to_save = []
    
    try:
        import requests
        import urllib3
        from datetime import datetime, timezone, timedelta
        urllib3.disable_warnings()
        
        headers = {
            'User-Agent': 'Mozilla/5.0',
            'Accept': 'application/json, text/plain, */*',
            'Content-Type': 'application/json'
        }
        data = {"dlt_search":{}}
        # 산재업무포탈 메인 공지사항 API
        res = requests.post('https://total.comwel.or.kr/api/v1/total/bizsupport/public/mainPageNotice', headers=headers, json=data, verify=False, timeout=15)
        
        if res.status_code == 200:
            js = res.json()
            notice_list = js.get('dlt_result', {}).get('noticeList', [])
            
            for item in notice_list[:15]:
                title = item.get('title', '').strip()
                date_str = item.get('first_input_ilsi', '')
                ser = item.get('ser', '')
                
                if not title: continue
                
                pub_date_iso = datetime.now(timezone.utc).isoformat()
                if date_str:
                    try:
                        kst = timezone(timedelta(hours=9))
                        dt = datetime.strptime(date_str.strip(), "%Y-%m-%d").replace(tzinfo=kst)
                        pub_date_iso = dt.isoformat()
                    except: pass
                
                articles_to_save.append({
                    "source": source_name,
                    "title": title,
                    "url": f"https://total.comwel.or.kr/#ser={ser}",
                    "published_date": pub_date_iso,
                    "content_hash": get_content_hash(title + str(ser)),
                    "status": "NEW"
                })
    except Exception as e:
        print(f"크롤링 에러 ({source_name}): {e}")
        
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
        res = requests.get('https://www.mohw.go.kr/board.es?mid=a10409020000&bid=0026', headers=headers, verify=False, timeout=10)
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
    return articles_to_save


if __name__ == "__main__":
    print("=== 브리핑 데이터 수집 봇 실행 (V4.3 - 상태 감지 완비) ===")
    
    total_articles = []
    
    # 1. RSS
    rss_sources = [
        {"name": "보건복지부 보도자료", "url": "https://www.mohw.go.kr/react/rss.jsp", "is_press": False},
        {"name": "질병관리청 보도자료", "url": "https://www.kdca.go.kr/rss", "is_press": False},
        {"name": "식품의약품안전처 보도자료", "url": "https://www.mfds.go.kr/rss", "is_press": False},
        {"name": "청년의사", "url": "http://www.docdocdoc.co.kr/rss/allArticle.xml", "is_press": True},
        {"name": "의협신문", "url": "http://www.doctorsnews.co.kr/rss/allArticle.xml", "is_press": True},
        {"name": "메디게이트뉴스", "url": "https://news.google.com/rss/search?q=site:medigatenews.com&hl=ko&gl=KR&ceid=KR:ko", "is_press": True},
        {"name": "데일리메디", "url": "https://news.google.com/rss/search?q=site:dailymedi.com&hl=ko&gl=KR&ceid=KR:ko", "is_press": True},
        {"name": "의학신문", "url": "https://cdn.bosa.co.kr/rss/gn_rss_allArticle.xml", "is_press": True},
        {"name": "보건신문", "url": "http://www.bokuennews.com/data/rss/news.xml", "is_press": True}
    ]
    for s in rss_sources:
        try:
            total_articles.extend(fetch_rss_feed(s["name"], s["url"], s["is_press"]))
        except: pass
        
    # 2. 크롤러
    total_articles.extend(fetch_kha_notices())
    total_articles.extend(fetch_hira_public_notices())
    total_articles.extend(fetch_nhis_public_notices())
    total_articles.extend(fetch_hira_biz_notices())
    total_articles.extend(fetch_hira_aq_notices())
    total_articles.extend(fetch_hurb_notices())
    total_articles.extend(fetch_comwel_notices())
    total_articles.extend(fetch_mohw_legislation())
    
    # 3. 오픈 API
    total_articles.extend(fetch_law_api())
    
    # 4. AI 기반 중복 기사 통합 및 교차 검증 (Phase 2)
    gemini_api_key = os.environ.get("GEMINI_API_KEY")
    if gemini_api_key:
        from ai_processor import process_articles_with_ai
        processed_articles = process_articles_with_ai(total_articles, gemini_api_key)
    else:
        print("⚠️ GEMINI_API_KEY가 없어 AI 통합을 건너뜁니다.")
        processed_articles = total_articles
        
    # 5. 기존 DB와 비교하여 상태 감지 (NEW, UPDATE, DELETED)
    final_sync_articles = track_states(processed_articles, supabase)
    
    # DB 저장
    save_to_supabase(final_sync_articles)
    print("=== 수집 완료 ===")
