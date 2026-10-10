ALTER TABLE papers ADD COLUMN metadata jsonb NOT NULL DEFAULT '{}'::jsonb;
