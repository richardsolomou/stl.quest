CREATE TABLE requests_with_owner (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  file_name TEXT NOT NULL,
  file_path TEXT NOT NULL,
  quantity INTEGER NOT NULL,
  owner_user_id TEXT NOT NULL REFERENCES "user"(id) ON DELETE RESTRICT,
  requester_email TEXT NOT NULL,
  requester_name TEXT,
  notes TEXT,
  source_url TEXT,
  thumbnail_path TEXT,
  preview_path TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  assets_generated_at INTEGER,
  printer_id TEXT,
  print_type TEXT CHECK (print_type IN ('resin', 'filament'))
);

INSERT INTO requests_with_owner (
  id, name, file_name, file_path, quantity, owner_user_id, requester_email, requester_name,
  notes, source_url, thumbnail_path, preview_path, created_at, updated_at, assets_generated_at,
  printer_id, print_type
)
SELECT
  requests.id, requests.name, requests.file_name, requests.file_path, requests.quantity,
  (SELECT id FROM "user" WHERE email = requests.requester_email COLLATE NOCASE),
  requests.requester_email, requests.requester_name, requests.notes, requests.source_url,
  requests.thumbnail_path, requests.preview_path, requests.created_at, requests.updated_at,
  requests.assets_generated_at, requests.printer_id, requests.print_type
FROM requests;

DROP TABLE requests;
ALTER TABLE requests_with_owner RENAME TO requests;

CREATE INDEX requests_created ON requests(created_at DESC);
CREATE INDEX requests_print_type ON requests(print_type);
CREATE INDEX requests_printer_id ON requests(printer_id);
CREATE INDEX requests_owner_user_id ON requests(owner_user_id);

CREATE TABLE upload_sessions_with_owner (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL REFERENCES "user"(id) ON DELETE RESTRICT,
  bytes INTEGER NOT NULL DEFAULT 0,
  expires_at INTEGER NOT NULL,
  completed_request_id TEXT
);

INSERT INTO upload_sessions_with_owner (id, owner_id, bytes, expires_at, completed_request_id)
SELECT id, owner_id, bytes, expires_at, completed_request_id
FROM upload_sessions;

DROP TABLE upload_sessions;
ALTER TABLE upload_sessions_with_owner RENAME TO upload_sessions;

CREATE INDEX upload_sessions_owner ON upload_sessions(owner_id, expires_at);
