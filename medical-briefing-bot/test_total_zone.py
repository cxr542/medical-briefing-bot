import requests
import urllib3
urllib3.disable_warnings()

headers = {'User-Agent': 'Mozilla/5.0'}
data = "SSV:utf-8\x1eWMONID=jUh0mXoQDhS\x1f"
res = requests.post('https://aq.hira.or.kr/com/co/selectTotalZoneList.ndo', data=data.encode('utf-8'), headers=headers, verify=False, timeout=10)
print(res.text[:500])
