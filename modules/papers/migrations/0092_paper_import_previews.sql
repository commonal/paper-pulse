CREATE TABLE paper_import_previews (
  id uuid PRIMARY KEY,
  input_key text NOT NULL UNIQUE,
  pdf_sha256 text,
  pdf_data bytea,
  state text NOT NULL DEFAULT 'ready',
  result jsonb NOT NULL DEFAULT '{}'::jsonb,
  material jsonb,
  error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
