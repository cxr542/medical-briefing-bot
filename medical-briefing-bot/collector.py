import os
import hashlib
from datetime import datetime, timezone, timedelta
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
        url = "https://www.kha.or.kr/kha_home/board/noticeList.do"
        # 병협 사이트는 경우에 따라 User-Agent를 요구할 수 있음
        headers = {'User-Agent': 'Mozilla/5.0'}
        response = requests.get(url, headers=headers, timeout=10)
        soup = BeautifulSoup(response.text, 'html.parser')
        
        # 병협 공지사항 테이블 파싱 로직 (실제 HTML 구조에 맞춰 조정 필요)
        # 예시로 최근 3개의 공지사항만 추출한다고 가정
        today = datetime.now(timezone.utc).isoformat()
        
        # TODO: 실제 병협 사이트의 tr > td 파싱
        articles_to_save.append({
            "source": source_name,
            "title": "[모의] 2026년도 병원신임평가 시행계획 안내",
            "url": "https://www.kha.or.kr/kha_home/board/noticeList.do?id=123",
            "published_date": today,
            "content_hash": get_content_hash("2026년도 병원신임평가 시행계획 안내"),
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

# 4. 건강보험심사평가원 공개 공지사항 스크래퍼
def fetch_hira_public_notices():
    source_name = "심사평가원 공지사항"
    print(f"🔄 크롤링 수집: {source_name}")
    articles_to_save = []
    try:
        # 실제 사이트 DOM 구조에 맞는 파싱 로직 구현 공간
        # 현재는 MVP 구동을 위한 모의 데이터 반환
        articles_to_save.append({
            "source": source_name,
            "title": "[안내] 2026년도 요양급여비용 심사 및 평가 방향",
            "url": "https://www.hira.or.kr/dummy-hira-1",
            "published_date": datetime.now(timezone.utc).isoformat(),
            "content_hash": get_content_hash("요양급여비용 심사 및 평가 방향"),
            "status": "NEW"
        })
    except Exception as e:
        print(f"크롤링 에러 ({source_name}): {e}")
    return articles_to_save

# 5. 국민건강보험공단 공개 공지사항 스크래퍼
def fetch_nhis_public_notices():
    source_name = "국민건강보험공단 공지사항"
    print(f"🔄 크롤링 수집: {source_name}")
    articles_to_save = []
    try:
        articles_to_save.append({
            "source": source_name,
            "title": "[공지] 요양기관 본인확인 강화 제도 시행 세부 지침 안내",
            "url": "https://www.nhis.or.kr/dummy-nhis-1",
            "published_date": datetime.now(timezone.utc).isoformat(),
            "content_hash": get_content_hash("요양기관 본인확인 지침"),
            "status": "NEW"
        })
    except Exception as e:
        print(f"크롤링 에러 ({source_name}): {e}")
    return articles_to_save

def save_to_supabase(articles: list):
    if not articles: return
    new_count = 0
    for article in articles:
        try:
            supabase.table('articles').insert(article).execute()
            new_count += 1
        except Exception as e:
            if "23505" not in str(e) and "duplicate key" not in str(e).lower():
                print(f"⚠️ 저장 실패 [{article['title']}]: {e}")
    print(f"✅ 총 {new_count}개의 새로운 게시물을 DB에 저장했습니다.")

if __name__ == "__main__":
    print("=== 브리핑 데이터 수집 봇 실행 (V4.2 - 공개 사이트 확장) ===")
    
    total_articles = []
    
    # 1. RSS
    rss_sources = [
        {"name": "보건복지부 보도자료", "url": "https://www.mohw.go.kr/react/rss.jsp", "is_press": False},
        {"name": "질병관리청 보도자료", "url": "https://www.kdca.go.kr/rss", "is_press": False},
        {"name": "식품의약품안전처 보도자료", "url": "https://www.mfds.go.kr/rss", "is_press": False},
        {"name": "메디게이트뉴스", "url": "http://www.medigatenews.com/rss", "is_press": True},
        {"name": "데일리메디", "url": "http://www.dailymedi.com/rss/allArticle.xml", "is_press": True}
    ]
    for s in rss_sources:
        try:
            total_articles.extend(fetch_rss_feed(s["name"], s["url"], s["is_press"]))
        except: pass
        
    # 2. 크롤러
    total_articles.extend(fetch_kha_notices())
    total_articles.extend(fetch_hira_public_notices())
    total_articles.extend(fetch_nhis_public_notices())
    
    # 3. 오픈 API
    total_articles.extend(fetch_law_api())
    
    # DB 저장
    save_to_supabase(total_articles)
    print("=== 수집 완료 ===")
