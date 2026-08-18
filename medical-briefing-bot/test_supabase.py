import os
from dotenv import load_dotenv
from supabase import create_client, Client

# .env 파일 로드
load_dotenv()

url: str = os.environ.get("SUPABASE_URL")
key: str = os.environ.get("SUPABASE_KEY")

try:
    print("Supabase 연결 시도 중...")
    supabase: Client = create_client(url, key)
    
    # articles 테이블 접근 테스트
    response = supabase.table('articles').select("*").limit(1).execute()
    print("✅ Supabase 연동 성공!")
    print("articles 테이블 데이터 조회:", response.data)
except Exception as e:
    print("❌ Supabase 연동 실패 또는 articles 테이블이 존재하지 않습니다.")
    print("에러 메시지:", e)
