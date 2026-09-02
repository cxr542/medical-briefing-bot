import requests
import urllib3
urllib3.disable_warnings()
headers = {'User-Agent': 'Mozilla/5.0'}
data = "SSV:utf-8\x1eWMONID=MSZtgU7cUzJ\x1fmenuId=\x1fDataset:dsParam\x1e_RowType_\x1fsearchTpCd:STRING(256)\x1fsearchTxt:STRING(256)\x1ftotCnt:STRING(256)\x1fcurrentPage:STRING(256)\x1frecordCountPerPage:STRING(256)\x1ffirstIndex:STRING(256)\x1fbrdKndCd:STRING(256)\x1fbrdSno:STRING(256)\x1eN\x1f\x1f\x1f\x1f\x1f\x1f\x1f\x1f"
res = requests.post('https://aq.hira.or.kr/com/co/selectPopupList.ndo', data=data.encode('utf-8'), headers=headers, verify=False, timeout=10)
print(f"Size: {len(res.text)}")
for line in res.text.split('<Dataset id='):
    if '폐렴' in line or '환자경험평가' in line:
        ds_id = line.split('>')[0].strip('"')
        print(f"FOUND IN DATASET: {ds_id}")
        print(line[:1000])
