ALTER TABLE public.articles
    ADD COLUMN IF NOT EXISTS keyword_boundary JSONB DEFAULT NULL;
