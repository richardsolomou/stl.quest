CREATE TABLE operations (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('move', 'delete')),
  payload_json TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('prepared', 'assets_moved', 'committed')),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX operations_state ON operations(state, created_at);
