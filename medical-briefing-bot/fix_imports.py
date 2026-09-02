import re
with open('collector.py', 'r') as f:
    content = f.read()

# Fix the datetime error by moving imports to the top of the functions or just replacing it
content = content.replace("pub_date_iso = datetime.now(timezone.utc).isoformat()", "from datetime import datetime, timezone, timedelta\n                    pub_date_iso = datetime.now(timezone.utc).isoformat()")

with open('collector.py', 'w') as f:
    f.write(content)
