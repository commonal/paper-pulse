CREATE TABLE IF NOT EXISTS paper_illustrations (
  paper_id uuid PRIMARY KEY REFERENCES papers(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'generating', 'ready', 'failed', 'unavailable')),
  input_signature text NOT NULL,
  selections jsonb NOT NULL DEFAULT '[]'::jsonb,
  model text NOT NULL DEFAULT '',
  prompt_version text NOT NULL DEFAULT '',
  receipt_id bigint,
  error text,
  updated_at timestamptz NOT NULL DEFAULT now()
);
