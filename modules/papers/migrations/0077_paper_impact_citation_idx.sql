CREATE INDEX CONCURRENTLY IF NOT EXISTS paper_impact_candidates_citation_idx ON paper_impact_candidates (citation_count DESC NULLS LAST, fetched_at DESC);
