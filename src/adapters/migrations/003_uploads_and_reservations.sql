ALTER TABLE operations RENAME TO operations_v2;

CREATE TABLE operations (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('move', 'delete', 'upload')),
  job_id TEXT,
  upload_id TEXT,
  payload_json TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('prepared', 'assets_moved', 'committed')),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

INSERT INTO operations (id, kind, job_id, payload_json, state, created_at, updated_at)
SELECT id, kind, json_extract(payload_json, '$.jobId'), payload_json, state, created_at, updated_at
FROM operations_v2;

DROP TABLE operations_v2;

CREATE INDEX operations_state ON operations(state, created_at);
CREATE UNIQUE INDEX operations_active_job ON operations(job_id) WHERE job_id IS NOT NULL AND state <> 'committed';
CREATE UNIQUE INDEX operations_upload ON operations(upload_id) WHERE upload_id IS NOT NULL;

CREATE TABLE upload_sessions (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  bytes INTEGER NOT NULL DEFAULT 0,
  expires_at INTEGER NOT NULL,
  completed_job_id TEXT
);

CREATE INDEX upload_sessions_owner ON upload_sessions(owner_id, expires_at);
