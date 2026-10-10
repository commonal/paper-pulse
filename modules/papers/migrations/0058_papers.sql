CREATE TABLE IF NOT EXISTS papers (
  id uuid PRIMARY KEY, title text NOT NULL, authors text NOT NULL DEFAULT '',
  published text NOT NULL DEFAULT '', topic text NOT NULL DEFAULT '', abstract text NOT NULL DEFAULT '',
  source_url text NOT NULL UNIQUE, pdf_url text NOT NULL DEFAULT '', code_url text NOT NULL DEFAULT '',
  version text NOT NULL DEFAULT '未标注', status text NOT NULL DEFAULT 'unread' CHECK (status IN ('unread', 'reading', 'done')),
  pdf_data bytea, pdf_sha256 text, created_at timestamptz NOT NULL DEFAULT now()
);
