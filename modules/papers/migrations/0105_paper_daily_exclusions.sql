CREATE TABLE IF NOT EXISTS paper_daily_exclusions (
  queue_date date NOT NULL,
  paper_id uuid NOT NULL REFERENCES papers(id) ON DELETE CASCADE,
  pdf_sha256 text NOT NULL REFERENCES paper_pdf_inspections(pdf_sha256),
  reason text NOT NULL,
  removed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (queue_date, paper_id, pdf_sha256)
);
