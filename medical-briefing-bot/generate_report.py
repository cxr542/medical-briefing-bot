import os
import webbrowser
from datetime import datetime
from jinja2 import Environment, FileSystemLoader
from dotenv import load_dotenv
from supabase import create_client, Client
from collections import defaultdict

load_dotenv()

url: str = os.environ.get("SUPABASE_URL")
key: str = os.environ.get("SUPABASE_KEY")
supabase: Client = create_client(url, key)

def fetch_recent_articles():
    """Supabase에서 수집된 기사들을 발행일 최신순으로 가져옵니다."""
    response = supabase.table('articles').select("*").order('published_date', desc=True).execute()
    return response.data

def generate_html_report():
    articles = fetch_recent_articles()
    
    # 출처별로 기사를 그룹화
    articles_by_source = defaultdict(list)
    for article in articles:
        articles_by_source[article['source']].append(article)
        
    # Jinja2 템플릿 로드
    env = Environment(loader=FileSystemLoader('.'))
    template = env.get_template('dashboard_template.html')
    
    # HTML 렌더링
    html_content = template.render(
        current_date=datetime.now().strftime("%Y년 %m월 %d일"),
        articles_by_source=dict(articles_by_source)
    )
    
    # HTML 파일 저장
    output_filename = f"morning_briefing_{datetime.now().strftime('%Y%m%d')}.html"
    output_path = os.path.abspath(output_filename)
    
    with open(output_path, 'w', encoding='utf-8') as f:
        f.write(html_content)
        
    print(f"✅ 대시보드 리포트가 생성되었습니다: {output_path}")
    return output_path

if __name__ == "__main__":
    report_path = generate_html_report()
    # 생성된 파일을 기본 웹 브라우저로 엽니다.
    webbrowser.open(f"file://{report_path}")
