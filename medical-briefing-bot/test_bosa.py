import feedparser
feed = feedparser.parse("https://cdn.bosa.co.kr/rss/gn_rss_allArticle.xml")
print(feed.entries)
