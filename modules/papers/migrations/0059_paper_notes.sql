CREATE TABLE IF NOT EXISTS paper_notes (
  id uuid PRIMARY KEY, paper_id uuid NOT NULL REFERENCES papers(id) ON DELETE CASCADE,
  title text NOT NULL, markdown text NOT NULL, page integer CHECK (page BETWEEN 1 AND 10000),
  version text NOT NULL, pdf_sha256 text, revision integer NOT NULL DEFAULT 1,
  updated_at timestamptz NOT NULL DEFAULT now()
);
