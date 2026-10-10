CREATE TABLE paper_candidates (
  paper_id uuid NOT NULL REFERENCES papers(id) ON DELETE CASCADE,
  plan_id text NOT NULL REFERENCES paper_discovery_plans(id) ON DELETE CASCADE,
  first_discovered_at timestamptz NOT NULL DEFAULT now(),
  matched_categories text[] NOT NULL DEFAULT '{}',
  matched_keywords text[] NOT NULL DEFAULT '{}',
  score double precision NOT NULL DEFAULT 0,
  selected_date date,
  PRIMARY KEY (paper_id, plan_id)
);
