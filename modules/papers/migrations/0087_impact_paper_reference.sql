ALTER TABLE paper_impact_candidates ADD CONSTRAINT paper_impact_paper_fk FOREIGN KEY (paper_id) REFERENCES papers(id) ON DELETE SET NULL NOT VALID;
