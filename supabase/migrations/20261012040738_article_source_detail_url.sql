-- Optional display metadata. Identity remains articles.url; no backfill.
ALTER TABLE public.articles
    ADD COLUMN IF NOT EXISTS source_detail_url text;
