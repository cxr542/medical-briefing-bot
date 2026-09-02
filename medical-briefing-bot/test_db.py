from supabase import create_client, Client
import os
from dotenv import load_dotenv

load_dotenv()

url = os.getenv('SUPABASE_URL')
key = os.getenv('SUPABASE_KEY')
supabase: Client = create_client(url, key)

res = supabase.table('articles').select('*').eq('source', '심평원 업무포탈 (공지사항)').order('published_date', desc=True).limit(5).execute()
for row in res.data:
    print(f"[{row['published_date']}] {row['title']}")
