CREATE INDEX CONCURRENTLY IF NOT EXISTS paper_candidates_recent_idx ON paper_candidates (first_discovered_at DESC);
