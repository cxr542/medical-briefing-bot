import re

with open('collector.py', 'r') as f:
    content = f.read()

hira_aq_code = """
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
                                            "url": "https://aq.hira.or.kr/hira_aq/index.jsp", # SPA이므로 메인페이지 연결
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
"""

# Insert right before fetch_mohw_legislation
content = content.replace('def fetch_mohw_legislation():', hira_aq_code + '\n\ndef fetch_mohw_legislation():')
content = content.replace('total_articles.extend(fetch_mohw_legislation())', 'total_articles.extend(fetch_hira_aq_notices())\n    total_articles.extend(fetch_mohw_legislation())')

with open('collector.py', 'w') as f:
    f.write(content)
