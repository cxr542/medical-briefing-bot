# Frozen main 94d4e27 baseline function; loaded without importing Collector.
def track_states(new_articles: list, supabase: Client, incomplete_sources=None):
    """
    기존 DB 데이터와 비교하여 NEW, UPDATE, DELETED 상태를 판별합니다.
    """
    print("🔄 DB 기존 데이터와 비교하여 상태(NEW/UPDATE/DELETED)를 감지합니다...")

    # 1. DB에서 최근 7일치 기사 가져오기
    seven_days_ago = (datetime.now(timezone.utc) - timedelta(days=7)).isoformat()
    try:
        res = supabase.table('articles').select('*').gte('published_date', seven_days_ago).execute()
        db_articles = res.data
    except Exception as e:
        print(f"DB 데이터 조회 실패: {e}")
        db_articles = []

    # url을 키로 하는 딕셔너리로 변환
    db_dict = {a['url']: a for a in db_articles}
    incomplete_sources = incomplete_sources or set()

    final_articles_to_upsert = []

    # 2. 신규(NEW) 및 수정(UPDATE) 판별
    for new_art in new_articles:
        url = new_art['url']
        if url not in db_dict:
            new_art['status'] = 'NEW'
            final_articles_to_upsert.append(new_art)
        else:
            old_art = db_dict[url]
            category_changed = (
                'category' in new_art
                and old_art.get('category') != new_art.get('category')
            )
            keywords_changed = (
                'keywords' in new_art
                and old_art.get('keywords') != new_art.get('keywords')
            )
            is_merged_changed = (
                'is_merged' in new_art
                and old_art.get('is_merged') != new_art.get('is_merged')
            )
            if (old_art.get('content_hash') != new_art.get('content_hash')) or \
               is_merged_changed or category_changed or keywords_changed:
                new_art['status'] = 'UPDATE'
                final_articles_to_upsert.append(new_art)
            else:
                # 상태 변경 없음 (이미 DB에 똑같은 내용이 있음) -> Upsert 할 필요 없음
                pass

    # 3. 삭제(DELETED) 판별
    absent_urls = find_absent_article_urls(db_articles, new_articles, incomplete_sources)
    for old_url in absent_urls:
        old_art = db_dict[old_url]
        if old_art.get('status') != 'DELETED':
            old_art['status'] = 'DELETED'
            final_articles_to_upsert.append(old_art)

    return final_articles_to_upsert
