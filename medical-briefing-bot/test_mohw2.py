import requests
from bs4 import BeautifulSoup
import urllib3
urllib3.disable_warnings()

headers = {'User-Agent': 'Mozilla/5.0'}
res = requests.get('https://www.mohw.go.kr/board.es?mid=a10409020000&bid=0026', headers=headers, verify=False, timeout=10)
print(res.url)
soup = BeautifulSoup(res.text, 'html.parser')
for tr in soup.select('tbody tr')[:10]:
    tds = tr.select('td')
    if len(tds) >= 4:
        a = tds[1].select_one('a')
        if a:
            print("Notice:", a.text.strip(), tds[3].text.strip())
