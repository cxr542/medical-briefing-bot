import os
from dotenv import load_dotenv
from supabase import create_client, Client

load_dotenv()
url = os.environ.get("SUPABASE_URL")
key = os.environ.get("SUPABASE_KEY")
supabase = create_client(url, key)

try:
    res = supabase.table('articles').select('*').limit(1).execute()
    print("articles 테이블 정상 조회됨:", res.data)
except Exception as e:
    print("articles 조회 실패:", e)
