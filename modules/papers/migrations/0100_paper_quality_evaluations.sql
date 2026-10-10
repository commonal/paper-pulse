CREATE TABLE IF NOT EXISTS paper_quality_evaluations (
  id uuid PRIMARY KEY,
  paper_id uuid NOT NULL REFERENCES papers(id) ON DELETE CASCADE,
  version_id uuid NOT NULL,
  input_hash text NOT NULL,
  rubric_version text NOT NULL,
  input jsonb NOT NULL,
  status text NOT NULL CHECK (status IN ('queued','running','waiting','failed','ready')),
  result jsonb,
  model text,
  receipt_id bigint,
  error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (paper_id,version_id,input_hash,rubric_version)
);
