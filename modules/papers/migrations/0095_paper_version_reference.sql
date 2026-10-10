ALTER TABLE papers ADD CONSTRAINT papers_active_version_fkey FOREIGN KEY (active_version_id) REFERENCES paper_versions(id) NOT VALID;
