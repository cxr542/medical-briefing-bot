export interface RelatedLink {
  title: string;
  url: string;
  source: string;
  source_detail_url?: string | null;
}

export interface Article {
  id: number;
  source: string;
  title: string;
  url: string;
  published_date: string;
  status: string;
  created_at?: string | null;
  category?: string;
  keywords?: string;
  keyword_boundary?: unknown;
  is_merged?: boolean;
  related_links?: RelatedLink[];
  source_detail_url?: string | null;
}

