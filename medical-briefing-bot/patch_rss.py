import re

with open('collector.py', 'r') as f:
    content = f.read()

content = content.replace('{"name": "데일리메디", "url": "https://news.google.com/rss/search?q=site:dailymedi.com&hl=ko&gl=KR&ceid=KR:ko", "is_press": True}',
                          '{"name": "데일리메디", "url": "https://news.google.com/rss/search?q=site:dailymedi.com&hl=ko&gl=KR&ceid=KR:ko", "is_press": True},\n        {"name": "의학신문", "url": "https://cdn.bosa.co.kr/rss/gn_rss_allArticle.xml", "is_press": True},\n        {"name": "보건신문", "url": "http://www.bokuennews.com/data/rss/news.xml", "is_press": True}')

with open('collector.py', 'w') as f:
    f.write(content)
