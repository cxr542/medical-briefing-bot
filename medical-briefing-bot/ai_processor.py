import os
import json
from pydantic import BaseModel, Field
from google import genai
from google.genai import types

class RelatedLink(BaseModel):
    title: str
    url: str
    source: str

class AnalyzedArticle(BaseModel):
    source: str
    title: str
    url: str
    published_date: str
    content_hash: str
    status: str
    category: str = Field(description="기사의 성격에 맞는 카테고리 (예: 보도/해명, 심사/수가, 일반공지, 평가 등)")
    keywords: str = Field(description="기사의 핵심 내용을 잘 나타내는 3개의 명사형 해시태그 (콤마로 구분, 예: #의대증원, #전공의, #건강보험)")
    related_links: list[RelatedLink] = Field(default_factory=list)
    is_merged: bool = False

class AnalyzedArticleList(BaseModel):
    articles: list[AnalyzedArticle]

def process_articles_with_ai(articles: list, api_key: str) -> list:
    """
    수집된 기사 리스트를 Gemini AI에 전달하여 카테고리/키워드를 추출하고 중복 기사를 통합합니다.
    """
    if not articles:
        return []

    print(f"🧠 Gemini AI를 사용하여 {len(articles)}개의 기사 분석을 시작합니다...")
    
    client = genai.Client(api_key=api_key)
    
    prompt = """
    당신은 보건의료 전문 뉴스 큐레이터입니다.
    아래 JSON 형태로 제공된 기사 목록을 분석하여 두 가지 작업을 수행하세요:

    1. **키워드 및 카테고리 추출**: 각 기사에 대해 적절한 'category'와 3개의 핵심 'keywords'를 생성하세요.
       - category 예시: '보도/해명', '심사/수가', '일반공지', '평가' 등
       - keywords 형식: '#단어1, #단어2, #단어3'

    2. **중복 통합 (Optional)**: 완전히 동일한 주제나 사건을 다루는 기사들이 있다면 하나로 묶어주세요.
       - 공공기관 보도자료를 항상 메인 기사로 선정하세요.
       - 나머지 중복 기사들은 메인 기사의 'related_links'에 포함시키세요.
       - 통합된 기사는 'is_merged'를 true로 설정하세요.

    결과물은 반드시 JSON 스키마를 따라야 하며, 누락되는 기사 없이 모두 포함되어야 합니다.
    """
    
    try:
        response = client.models.generate_content(
            model='gemini-2.5-flash',
            contents=[prompt, json.dumps(articles, ensure_ascii=False, indent=2)],
            config=types.GenerateContentConfig(
                response_mime_type="application/json",
                response_schema=AnalyzedArticleList,
                temperature=0.1,
            ),
        )
        
        result_json = response.text
        parsed_data = json.loads(result_json)
        return parsed_data.get("articles", [])
        
    except Exception as e:
        print(f"❌ AI 처리 중 오류 발생: {e}")
        return articles
