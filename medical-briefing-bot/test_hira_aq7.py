import requests
import urllib3
urllib3.disable_warnings()

headers = {'User-Agent': 'Mozilla/5.0'}
data = "SSV:utf-8\x1eWMONID=jUh0mXoQDhS\x1fmenuId=\x1f"
res = requests.post('https://aq.hira.or.kr/com/co/selectMenu.ndo', data=data.encode('utf-8'), headers=headers, verify=False, timeout=10)
print(res.text[:500])
with open('menu.xml', 'w') as f:
    f.write(res.text)
