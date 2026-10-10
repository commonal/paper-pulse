CREATE TABLE paper_versions (
  id uuid PRIMARY KEY,
  paper_id uuid NOT NULL REFERENCES papers(id) ON DELETE CASCADE,
  version_key text NOT NULL,
  label text NOT NULL,
  kind text NOT NULL DEFAULT 'uploaded',
  source_url text NOT NULL,
  pdf_url text NOT NULL DEFAULT '',
  pdf_sha256 text,
  pdf_data bytea,
  snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (paper_id, version_key)
);
