CREATE TABLE IF NOT EXISTS paper_arxiv_throttle (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  next_request_at timestamptz NOT NULL DEFAULT now(),
  blocked_until timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);
