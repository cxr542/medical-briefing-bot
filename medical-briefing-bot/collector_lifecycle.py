from typing import AbstractSet, Sequence, Set, TypedDict


class ArticleIdentity(TypedDict):
    source: str
    url: str


def find_absent_article_urls(
    existing_articles: Sequence[ArticleIdentity],
    collected_articles: Sequence[ArticleIdentity],
    incomplete_sources: AbstractSet[str],
) -> Set[str]:
    new_urls = {article["url"] for article in collected_articles}
    fetched_sources = {article["source"] for article in collected_articles}
    reconciled_sources = fetched_sources - incomplete_sources
    return {
        article["url"]
        for article in existing_articles
        if article["source"] in reconciled_sources and article["url"] not in new_urls
    }
