CREATE TABLE paper_impact_status (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  state text NOT NULL DEFAULT 'idle' CHECK (state IN ('idle', 'running', 'ready', 'failed')),
  candidate_count integer NOT NULL DEFAULT 0 CHECK (candidate_count >= 0),
  query_start date,
  query_end date,
  error text,
  captured_at timestamptz
);
