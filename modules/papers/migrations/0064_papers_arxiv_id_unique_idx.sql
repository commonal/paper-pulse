CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS papers_arxiv_id_unique_idx ON papers (arxiv_id) WHERE arxiv_id IS NOT NULL;
