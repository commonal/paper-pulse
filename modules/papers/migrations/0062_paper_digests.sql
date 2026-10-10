CREATE TABLE IF NOT EXISTS paper_digests (
  paper_id uuid PRIMARY KEY REFERENCES papers(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'generating', 'ready', 'failed', 'unavailable')),
  model text NOT NULL DEFAULT '',
  prompt_version text NOT NULL DEFAULT '',
  sections jsonb NOT NULL DEFAULT '[]'::jsonb,
  material_updated_at timestamptz,
  receipt_id bigint,
  error text,
  updated_at timestamptz NOT NULL DEFAULT now()
);
