from datetime import datetime, timedelta, timezone
import hashlib

import requests
import urllib3


source_collection_diagnostics: dict[str, str] = {}


def get_content_hash(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def fetch_comwel_notices() -> list[dict[str, str]]:
    source_name = "산재업무포탈"
    print(f"🔄 API 수집: {source_name}")
    articles_to_save: list[dict[str, str]] = []

    try:
        urllib3.disable_warnings()

        headers = {
            "User-Agent": "Mozilla/5.0",
            "Accept": "application/json, text/plain, */*",
            "Content-Type": "application/json",
        }
        data = {"dlt_search": {}}
        res = requests.post(
            "https://total.comwel.or.kr/api/v1/total/bizsupport/public/mainPageNotice",
            headers=headers,
            json=data,
            verify=False,
            timeout=15,
        )

        if res.status_code != 200:
            raise ValueError(
                f"산재업무포탈 API HTTP 오류: status={res.status_code}, url={res.url}"
            )

        try:
            js = res.json()
        except ValueError as error:
            raise ValueError("산재업무포탈 API JSON 디코딩 실패") from error

        if not isinstance(js, dict) or "dlt_result" not in js:
            raise ValueError("산재업무포탈 API 응답에 dlt_result가 없습니다")
        dlt_result = js["dlt_result"]
        if not isinstance(dlt_result, dict) or "noticeList" not in dlt_result:
            raise ValueError("산재업무포탈 API 응답에 noticeList가 없습니다")
        notice_list = dlt_result["noticeList"]
        if not isinstance(notice_list, list):
            raise ValueError("산재업무포탈 API noticeList가 list가 아닙니다")

        for item in notice_list[:15]:
            title = item.get("title", "").strip()
            date_str = item.get("first_input_ilsi", "")
            ser = item.get("ser", "")

            if not title:
                continue

            pub_date_iso = datetime.now(timezone.utc).isoformat()
            if date_str:
                try:
                    kst = timezone(timedelta(hours=9))
                    dt = datetime.strptime(date_str.strip(), "%Y-%m-%d").replace(tzinfo=kst)
                    pub_date_iso = dt.isoformat()
                except ValueError:
                    pass

            articles_to_save.append(
                {
                    "source": source_name,
                    "title": title,
                    "url": f"https://total.comwel.or.kr/#ser={ser}",
                    "published_date": pub_date_iso,
                    "content_hash": get_content_hash(title + str(ser)),
                    "status": "NEW",
                }
            )
        source_collection_diagnostics[source_name] = (
            f"noticeList={len(notice_list)} collected={len(articles_to_save)}"
        )
    except Exception as error:
        print(f"크롤링 에러 ({source_name}): {error}")
        raise

    return articles_to_save
