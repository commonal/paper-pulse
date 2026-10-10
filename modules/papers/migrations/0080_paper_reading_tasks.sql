CREATE TABLE IF NOT EXISTS paper_reading_tasks (
  paper_id uuid PRIMARY KEY REFERENCES papers(id) ON DELETE CASCADE,
  run_id uuid NOT NULL,
  status text NOT NULL CHECK (status IN ('queued','running','waiting','failed','ready','unavailable')),
  stage text NOT NULL CHECK (stage IN ('material','coverage','reading','review','illustrations','complete')),
  options jsonb NOT NULL DEFAULT '{}'::jsonb,
  coverage jsonb,
  receipt_id bigint,
  error text,
  updated_at timestamptz NOT NULL DEFAULT now()
);
