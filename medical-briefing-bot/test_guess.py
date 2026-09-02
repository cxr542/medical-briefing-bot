import requests
import urllib3
urllib3.disable_warnings()

headers = {'User-Agent': 'Mozilla/5.0'}
data = "SSV:utf-8\x1eWMONID=jUh0mXoQDhS\x1f"

endpoints = [
    '/bd/bda/selectBoardList.ndo',
    '/bd/bda/selectBrdList.ndo',
    '/pd/pda/selectHlpdPgList.ndo',
    '/pd/pda/selectBoardList.ndo',
    '/com/co/selectBrdList.ndo',
    '/com/co/selectBoardList.ndo'
]

for e in endpoints:
    try:
        res = requests.post(f'https://aq.hira.or.kr{e}', data=data.encode('utf-8'), headers=headers, verify=False, timeout=3)
        if '404' not in res.text:
            print(f"FOUND: {e} -> len: {len(res.text)}")
            print(res.text[:300])
    except: pass
