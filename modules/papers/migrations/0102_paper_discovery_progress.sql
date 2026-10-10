CREATE TABLE IF NOT EXISTS paper_discovery_progress (
  queue_date date NOT NULL,
  plan_id text NOT NULL REFERENCES paper_discovery_plans(id) ON DELETE CASCADE,
  query_key text NOT NULL,
  phase text NOT NULL DEFAULT 'recent' CHECK (phase IN ('recent','previous','done')),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','waiting','ready','failed')),
  attempts integer NOT NULL DEFAULT 0,
  recent_count integer,
  next_attempt_at timestamptz,
  error text,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (queue_date,plan_id)
);
