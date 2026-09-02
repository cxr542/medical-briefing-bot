import requests
from bs4 import BeautifulSoup
import urllib3
urllib3.disable_warnings()

headers = {'User-Agent': 'Mozilla/5.0'}
res = requests.get('https://www.mohw.go.kr/board.es?mid=a10409020000&bid=0026', headers=headers, verify=False, timeout=10)
soup = BeautifulSoup(res.text, 'html.parser')

print(soup.select('table'))
print(soup.select('.board_list'))
