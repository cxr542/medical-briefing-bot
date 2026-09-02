with open('.github/workflows/daily_collector.yml', 'r') as f:
    content = f.read()

content = content.replace(
    "- cron: '0 21,0,3,6 * * *'",
    "- cron: '0 21,3,6 * * *'\n    # 한국 시간(KST) 오전 8시 30분 = UTC 시간 기준 23시 30분\n    - cron: '30 23 * * *'"
)

with open('.github/workflows/daily_collector.yml', 'w') as f:
    f.write(content)
