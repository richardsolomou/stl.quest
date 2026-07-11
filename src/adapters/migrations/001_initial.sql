CREATE TABLE users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  password_hash TEXT,
  role TEXT NOT NULL CHECK (role IN ('operator', 'requester')),
  color TEXT,
  created_at INTEGER NOT NULL
);

CREATE TABLE sessions (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL
);

CREATE TABLE jobs (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  file_name TEXT NOT NULL,
  file_path TEXT NOT NULL,
  quantity INTEGER NOT NULL,
  requester_email TEXT NOT NULL,
  requester_name TEXT,
  notes TEXT,
  thumbnail TEXT,
  preview_path TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE job_statuses (
  job_id TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  status_id TEXT NOT NULL,
  quantity INTEGER NOT NULL,
  sort_order REAL,
  PRIMARY KEY (job_id, status_id)
);

CREATE INDEX sessions_expiry ON sessions(expires_at);
CREATE INDEX jobs_created ON jobs(created_at DESC);
