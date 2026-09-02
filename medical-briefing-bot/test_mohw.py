import requests
from bs4 import BeautifulSoup
import urllib3
urllib3.disable_warnings()

headers = {'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)'}
try:
    res = requests.get('https://www.mohw.go.kr/board.es?mid=a10411010100&bid=0019', headers=headers, verify=False, timeout=10)
    print("STATUS:", res.status_code)
    soup = BeautifulSoup(res.text, 'html.parser')
    for a in soup.find_all('a'):
        if '법령' in a.text or '고시' in a.text or '훈령' in a.text:
            print("Link:", a.text.strip(), a.get('href'))
except Exception as e:
    print("Error:", e)
