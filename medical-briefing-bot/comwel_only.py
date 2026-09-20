from __future__ import annotations

import argparse
import os
import sys

from dotenv import load_dotenv

from collector_sources.comwel import fetch_comwel_notices

load_dotenv()


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Collect Comwel notices only")
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="collect and validate without writing to Supabase",
    )
    return parser.parse_args()


def save_articles(articles: list[dict[str, str]]) -> dict[str, int]:
    from supabase import create_client

    supabase_url = os.environ.get("SUPABASE_URL")
    supabase_key = os.environ.get("SUPABASE_KEY")
    if not supabase_url or not supabase_key:
        raise RuntimeError("SUPABASE_URL과 SUPABASE_KEY가 필요합니다")

    supabase = create_client(supabase_url, supabase_key)
    attempted = len(articles)
    succeeded = 0
    failed = 0
    for article in articles:
        try:
            supabase.table("articles").upsert(article, on_conflict="url").execute()
            succeeded += 1
        except Exception as error:  # noqa: BLE001 - keep processing individual articles
            failed += 1
            print(f"저장 실패 [{article.get('title', 'N/A')}]: {error}")

    return {
        "attempted": attempted,
        "succeeded": succeeded,
        "failed": failed,
    }


def main() -> int:
    args = parse_args()
    try:
        articles = fetch_comwel_notices()
    except Exception as error:  # noqa: BLE001 - CLI boundary reports a non-zero failure
        print(f"Comwel 수집 실패: {error}")
        return 1

    print(f"Collected: {len(articles)}")
    if args.dry_run:
        print("DRY RUN: Supabase write skipped")
        return 0

    try:
        stats = save_articles(articles)
    except Exception as error:  # noqa: BLE001 - CLI boundary reports a non-zero failure
        print(f"Comwel 저장 초기화 실패: {error}")
        return 1

    print(f"DB attempted: {stats['attempted']}")
    print(f"DB succeeded: {stats['succeeded']}")
    print(f"DB failed: {stats['failed']}")
    return 1 if stats["failed"] else 0


if __name__ == "__main__":
    sys.exit(main())
