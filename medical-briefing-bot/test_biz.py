from collector import fetch_hira_biz_notices
res = fetch_hira_biz_notices()
print(f"Total: {len(res)}")
for idx, r in enumerate(res[:5]):
    print(f"[{r['published_date']}] {r['title']}")
