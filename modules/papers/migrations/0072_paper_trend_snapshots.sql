CREATE TABLE paper_trend_snapshots (
  observed_on date NOT NULL,
  plan_id text NOT NULL REFERENCES paper_discovery_plans(id) ON DELETE CASCADE,
  window_start date NOT NULL,
  window_end date NOT NULL,
  recent_count integer NOT NULL CHECK (recent_count >= 0),
  previous_count integer NOT NULL CHECK (previous_count >= 0),
  source text NOT NULL DEFAULT 'arxiv',
  captured_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (observed_on, plan_id)
);
