import requests
import urllib3
urllib3.disable_warnings()

headers = {
    'User-Agent': 'Mozilla/5.0',
    'Content-Type': 'application/xml',
}

# The endpoint for board list in HIRA AQ might be /bd/bda/selectBoardList.ndo (like in HIRA Biz it was selectTotalZoneList.ndo or similar)
# Let's try /com/co/selectPopupList.ndo first, it has brdKndCd parameter.
payload = """<?xml version="1.0" encoding="UTF-8"?>
<Root xmlns="http://www.nexacroplatform.com/platform/dataset">
    <Parameters>
        <Parameter id="brdKndCd" type="string">{}</Parameter>
        <Parameter id="searchTpCd" type="string"></Parameter>
        <Parameter id="searchTxt" type="string"></Parameter>
        <Parameter id="firstIndex" type="int">1</Parameter>
        <Parameter id="recordCountPerPage" type="int">10</Parameter>
    </Parameters>
</Root>"""

for i in ['001', '002', '003', '004', '005', 'BDAA02']:
    try:
        res = requests.post('https://aq.hira.or.kr/com/co/selectPopupList.ndo', data=payload.format(i), headers=headers, verify=False, timeout=5)
        print(f"[{i}] len: {len(res.text)}")
    except: pass

