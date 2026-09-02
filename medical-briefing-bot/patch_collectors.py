import re

with open('collector.py', 'r') as f:
    content = f.read()

mohw_legislation_code = """
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
"""

nhis_medicare_code = """
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
"""

content = re.sub(r'def fetch_nhis_public_notices\(\):.*?(?=def |if __name__)', nhis_medicare_code + '\n\n', content, flags=re.DOTALL)
content = content.replace('if __name__ == "__main__":', mohw_legislation_code + '\n\nif __name__ == "__main__":')
content = content.replace('total_articles.extend(fetch_hira_biz_notices())', 'total_articles.extend(fetch_hira_biz_notices())\n    total_articles.extend(fetch_mohw_legislation())')

with open('collector.py', 'w') as f:
    f.write(content)
