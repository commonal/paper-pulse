CREATE TABLE paper_collection (
  paper_id uuid PRIMARY KEY REFERENCES papers(id) ON DELETE CASCADE,
  saved_at timestamptz NOT NULL DEFAULT now(),
  pinned boolean NOT NULL DEFAULT false,
  tags text[] NOT NULL DEFAULT '{}',
  directions text[] NOT NULL DEFAULT '{}',
  reason text NOT NULL DEFAULT ''
);
