CREATE TABLE IF NOT EXISTS paper_reading_runs (
  run_id uuid PRIMARY KEY,
  paper_id uuid NOT NULL REFERENCES papers(id) ON DELETE CASCADE,
  version_id uuid,
  kind text NOT NULL CHECK (kind IN ('full','illustrations')),
  initial_observed boolean NOT NULL,
  status text NOT NULL,
  stage text NOT NULL,
  cached_digest boolean NOT NULL DEFAULT false,
  started_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  error text,
  receipt_id bigint
);
