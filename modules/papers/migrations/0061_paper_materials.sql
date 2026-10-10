CREATE TABLE IF NOT EXISTS paper_materials (
  paper_id uuid PRIMARY KEY REFERENCES papers(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'parsing', 'ready', 'failed', 'unavailable')),
  parser text NOT NULL DEFAULT '', markdown text NOT NULL DEFAULT '', blocks jsonb NOT NULL DEFAULT '[]'::jsonb,
  error text, updated_at timestamptz NOT NULL DEFAULT now()
);
