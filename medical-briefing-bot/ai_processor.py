import os
import json
from pydantic import BaseModel, Field
from google import genai
from google.genai import types

class RelatedLink(BaseModel):
    title: str
    url: str
    source: str

class MergedArticle(BaseModel):
    source: str
    title: str
    url: str
    published_date: str
    content_hash: str
    status: str
    related_links: list[RelatedLink] = Field(default_factory=list)
    is_merged: bool = False

class MergedArticleList(BaseModel):
    articles: list[MergedArticle]

def process_articles_with_ai(articles: list, api_key: str) -> list:
    """
    수집된 기사 리스트를 Gemini AI에 전달하여 중복 기사를 통합합니다.
    """
    if not articles:
        return []

    print(f"🧠 Gemini AI를 사용하여 {len(articles)}개의 기사 분석 및 중복 통합을 시작합니다...")
    
    client = genai.Client(api_key=api_key)
    
    # AI에게 지시할 프롬프트
    prompt = """
    당신은 보건의료 전문 뉴스 큐레이터입니다.
    아래 JSON 형태로 제공된 기사 목록을 분석하여, **완전히 동일한 주제나 사건을 다루는 기사들을 그룹화**하세요.
    
    [통합 규칙]
    1. 그룹 내에 공공기관(보건복지부, 심사평가원, 질병관리청, 식품의약품안전처 등)의 공식 보도자료/공지사항이 포함되어 있다면, 반드시 해당 공공기관의 글을 '메인 기사'로 선정하세요.
    2. 공공기관 글이 없고 언론사 기사들만 있다면 그 중 가장 대표적인 하나를 '메인 기사'로 선정하세요.
    3. 메인 기사로 선정되지 않은 나머지 기사들은 메인 기사의 'related_links' 배열에 포함시키세요.
    4. 통합된 기사는 'is_merged'를 true로 설정하세요. 중복이 없어 단독으로 남은 기사는 'is_merged'를 false로 설정하고 'related_links'를 빈 배열로 두세요.
    5. 제공된 모든 기사는 누락 없이 결과 배열에 포함되어야 합니다. (메인 기사이거나, 다른 기사의 related_links에 속하거나 둘 중 하나여야 함)
    6. 원본 기사의 'content_hash', 'status', 'published_date' 값은 메인 기사의 값을 그대로 유지하세요.
    """
    
    try:
        response = client.models.generate_content(
            model='gemini-2.5-flash',
            contents=[prompt, json.dumps(articles, ensure_ascii=False, indent=2)],
            config=types.GenerateContentConfig(
                response_mime_type="application/json",
                response_schema=MergedArticleList,
                temperature=0.1, # 일관된 결과를 위해 낮은 온도 설정
            ),
        )
        
        result_json = response.text
        parsed_data = json.loads(result_json)
        return parsed_data.get("articles", [])
        
    except Exception as e:
        print(f"❌ AI 처리 중 오류 발생: {e}")
        # 오류 발생 시 원본 데이터 그대로 반환 (데이터 유실 방지)
        return articles
