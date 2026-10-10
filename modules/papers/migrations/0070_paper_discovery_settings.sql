CREATE TABLE paper_discovery_settings (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  daily_limit integer NOT NULL DEFAULT 3 CHECK (daily_limit BETWEEN 1 AND 3),
  hot_limit integer NOT NULL DEFAULT 1 CHECK (hot_limit BETWEEN 0 AND 1),
  candidate_days integer NOT NULL DEFAULT 7 CHECK (candidate_days BETWEEN 1 AND 14),
  updated_at timestamptz NOT NULL DEFAULT now()
);
