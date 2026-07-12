ALTER TABLE plate_model_analysis ADD COLUMN analysis_version INTEGER NOT NULL DEFAULT 1;

CREATE TABLE IF NOT EXISTS orientation_analysis_jobs (
  request_id TEXT PRIMARY KEY REFERENCES requests(id) ON DELETE CASCADE,
  status TEXT NOT NULL CHECK (status IN ('pending', 'running', 'ready', 'failed')),
  analysis_version INTEGER NOT NULL,
  error TEXT,
  queued_at INTEGER NOT NULL,
  started_at INTEGER,
  finished_at INTEGER
);

CREATE INDEX IF NOT EXISTS orientation_analysis_jobs_status ON orientation_analysis_jobs(status, queued_at);
