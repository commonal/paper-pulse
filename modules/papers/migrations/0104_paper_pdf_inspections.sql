CREATE TABLE IF NOT EXISTS paper_pdf_inspections (
  pdf_sha256 text PRIMARY KEY,
  page_count integer NOT NULL CHECK (page_count > 0),
  inspected_at timestamptz NOT NULL DEFAULT now()
);
