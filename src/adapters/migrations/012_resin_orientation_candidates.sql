ALTER TABLE plate_model_analysis ADD COLUMN orientation_candidates TEXT;
ALTER TABLE plate_model_analysis ADD COLUMN content_hash TEXT;
CREATE INDEX IF NOT EXISTS plate_model_analysis_content_hash ON plate_model_analysis(content_hash);
