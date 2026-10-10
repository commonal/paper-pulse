CREATE INDEX CONCURRENTLY IF NOT EXISTS paper_impact_candidates_venue_idx ON paper_impact_candidates (venue_name, venue_type, fetched_at DESC);
