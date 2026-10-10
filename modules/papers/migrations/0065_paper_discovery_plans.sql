CREATE TABLE paper_discovery_plans (
  id text PRIMARY KEY,
  kind text NOT NULL CHECK (kind IN ('hot', 'personal')),
  title text NOT NULL,
  enabled boolean NOT NULL DEFAULT true,
  categories text[] NOT NULL DEFAULT '{}',
  keywords text[] NOT NULL DEFAULT '{}',
  updated_at timestamptz NOT NULL DEFAULT now()
);
