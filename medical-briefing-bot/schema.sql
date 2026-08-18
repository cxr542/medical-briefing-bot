-- Supabase Dashboard의 'SQL Editor' 메뉴에 들어가서 아래 코드를 복사하여 실행(Run)해주세요.

CREATE TABLE public.articles (
    id SERIAL PRIMARY KEY,
    source VARCHAR(255) NOT NULL, -- 예: '심평원 공지사항', '메디게이트뉴스'
    title VARCHAR(500) NOT NULL,
    url VARCHAR(1000) NOT NULL UNIQUE,
    published_date TIMESTAMP WITH TIME ZONE,
    content_hash VARCHAR(255), -- 내용 변경 감지용 (옵션)
    status VARCHAR(50) DEFAULT 'NEW', -- 상태값 ('NEW', 'UPDATE' 등)
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 데이터 검색 속도 향상을 위한 인덱스 생성
CREATE INDEX idx_articles_url ON public.articles(url);
CREATE INDEX idx_articles_source_date ON public.articles(source, published_date);
