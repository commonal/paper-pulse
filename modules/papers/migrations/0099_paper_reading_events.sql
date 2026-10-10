CREATE TABLE IF NOT EXISTS paper_reading_events (
  id bigserial PRIMARY KEY,
  run_id uuid NOT NULL REFERENCES paper_reading_runs(run_id) ON DELETE CASCADE,
  stage text NOT NULL,
  status text NOT NULL,
  action text NOT NULL,
  error text,
  receipt_id bigint,
  recorded_at timestamptz NOT NULL DEFAULT now()
);
