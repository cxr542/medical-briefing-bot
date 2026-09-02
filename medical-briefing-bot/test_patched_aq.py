from collector import fetch_hira_aq_notices
for a in fetch_hira_aq_notices():
    print(a['title'])
