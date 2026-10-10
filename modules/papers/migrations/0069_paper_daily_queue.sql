CREATE TABLE paper_daily_queue (
  queue_date date NOT NULL,
  paper_id uuid NOT NULL REFERENCES papers(id) ON DELETE CASCADE,
  plan_ids text[] NOT NULL DEFAULT '{}',
  reason text NOT NULL DEFAULT '',
  source_kind text NOT NULL CHECK (source_kind IN ('hot', 'personal')),
  score double precision NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (queue_date, paper_id)
);
