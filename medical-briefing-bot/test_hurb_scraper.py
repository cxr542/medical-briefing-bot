from playwright.sync_api import sync_playwright
import xml.etree.ElementTree as ET
from datetime import datetime, timezone, timedelta

def fetch_hurb_notices():
    source_name = "보건의료자원포탈"
    articles_to_save = []
    
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
                                        "source": f"{source_name}",
                                        "title": title,
                                        "url": "https://www.hurb.or.kr/hira_sg/index.jsp?sso=ok",
                                        "published_date": pub_date_iso,
                                        "status": "NEW"
                                    })
                except Exception as e:
                    pass
                    
        page.on("response", handle_response)
        
        page.goto('https://www.hurb.or.kr/hira_sg/index.jsp?sso=ok', wait_until='networkidle', timeout=30000)
        page.wait_for_timeout(3000)
        browser.close()
        
    return articles_to_save

if __name__ == "__main__":
    res = fetch_hurb_notices()
    print(f"Total: {len(res)}")
    for r in res:
        print(f"[{r['published_date']}] {r['title']}")
