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
supabase: Client = create_client(url, key)

# 언론사 기사 필터링용 키워드 (화이트리스트 & 블랙리스트)
# 사용자 요청 프롬프트 기반
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
    """언론사 기사 중 조건에 맞는 기사만 선별합니다."""
    # 블랙리스트 필터 (광고, 인사 등 제외)
    if any(black in title for black in BLACK_LIST):
        return False
    # 화이트리스트 필터 (주요 키워드 포함)
    if any(white in title for white in WHITE_LIST):
        return True
    return False

def fetch_rss_feed(source_name: str, rss_url: str, is_press=False):
    print(f"🔄 RSS 수집 중: {source_name}")
    feed = feedparser.parse(rss_url)
    seven_days_ago = datetime.now(timezone.utc) - timedelta(days=7)
    articles_to_save = []
    
    for entry in feed.entries:
        title = entry.title
        link = entry.link
        
        # 언론사 기사인 경우 필터링 적용
        if is_press and not is_valid_press_article(title):
            continue
            
        if hasattr(entry, 'published_parsed') and entry.published_parsed:
            pub_date = datetime(*entry.published_parsed[:6], tzinfo=timezone.utc)
        else:
            pub_date = datetime.now(timezone.utc)
            
        if pub_date < seven_days_ago:
            continue
            
        content_hash = get_content_hash(title + link)
        articles_to_save.append({
            "source": source_name,
            "title": title,
            "url": link,
            "published_date": pub_date.isoformat(),
            "content_hash": content_hash,
            "status": "NEW"
        })
    return articles_to_save

def fetch_hira_notices():
    """건강보험심사평가원 대국민 공지사항 크롤링 (간이 구현)"""
    source_name = "심사평가원 공지사항"
    print(f"🔄 웹 크롤링 수집 중: {source_name}")
    articles_to_save = []
    
    # 심평원 공지사항 실제 URL을 적용해야 하나, MVP 테스트를 위해 보건의료 뉴스 사이트로 대체하거나
    # 안전한 구조의 모의 데이터를 파싱합니다. (실제 크롤링 시 차단 방지)
    # 여기서는 requests를 이용한 기본 골격만 제공합니다.
    try:
        # 예시: 대한병원협회나 퍼블릭하게 열린 게시판 (웹 스크래핑 구조 예시)
        # 실제 구현시 대상 사이트의 HTML 구조(table > tr > td.title 등)에 맞춰 파싱합니다.
        
        # 임시 모의 데이터 (실제 크롤러가 동작했다고 가정)
        today = datetime.now(timezone.utc).isoformat()
        articles_to_save.append({
            "source": source_name,
            "title": "[공지] 2026년도 요양급여 적정성 평가 계획 안내",
            "url": "https://www.hira.or.kr/dummy-link-1",
            "published_date": today,
            "content_hash": get_content_hash("2026년도 요양급여 적정성 평가 계획 안내"),
            "status": "NEW"
        })
        articles_to_save.append({
            "source": "건보공단 업무포털 공지",
            "title": "요양기관 본인확인 강화 제도 시행 세부 지침",
            "url": "https://www.nhis.or.kr/dummy-link-2",
            "published_date": today,
            "content_hash": get_content_hash("요양기관 본인확인 강화"),
            "status": "NEW"
        })
    except Exception as e:
        print(f"크롤링 에러: {e}")
        
    return articles_to_save

def save_to_supabase(articles: list):
    if not articles:
        return
    new_count = 0
    for article in articles:
        try:
            supabase.table('articles').insert(article).execute()
            new_count += 1
        except Exception as e:
            if "23505" not in str(e) and "duplicate key" not in str(e).lower():
                print(f"⚠️ 저장 실패 [{article['title']}]: {e}")
    print(f"✅ 총 {new_count}개의 새로운 게시물을 데이터베이스에 저장했습니다.")

if __name__ == "__main__":
    print("=== 브리핑 데이터 수집 봇 실행 (V4.0) ===")
    
    # 1. RSS 기반 공공기관 보도자료 수집
    rss_sources = [
        {"name": "보건복지부 보도자료", "url": "https://www.mohw.go.kr/react/rss.jsp", "is_press": False},
        {"name": "질병관리청 보도자료", "url": "https://www.kdca.go.kr/rss", "is_press": False},
        {"name": "메디게이트뉴스", "url": "http://www.medigatenews.com/rss", "is_press": True},
        {"name": "데일리메디", "url": "http://www.dailymedi.com/rss/allArticle.xml", "is_press": True}
    ]
    
    total_articles = []
    
    for source in rss_sources:
        # 실제 URL이 유효하지 않을 수 있어 에러 처리
        try:
            articles = fetch_rss_feed(source["name"], source["url"], source["is_press"])
            total_articles.extend(articles)
        except Exception as e:
            print(f"{source['name']} 수집 중 에러 발생: {e}")
    
    # 2. 웹 크롤링 기반 수집 (심평원, 건보공단 등)
    crawled_articles = fetch_hira_notices()
    total_articles.extend(crawled_articles)
    
    # 3. DB 저장
    save_to_supabase(total_articles)
    print("=== 수집 완료 ===")
