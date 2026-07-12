CREATE TABLE IF NOT EXISTS asset_generation_jobs (
  request_id TEXT NOT NULL REFERENCES requests(id) ON DELETE CASCADE,
  stage TEXT NOT NULL CHECK (stage IN ('thumbnail', 'preview')),
  status TEXT NOT NULL CHECK (status IN ('pending', 'running', 'ready', 'skipped', 'failed')),
  error TEXT,
  queued_at INTEGER NOT NULL,
  started_at INTEGER,
  finished_at INTEGER,
  PRIMARY KEY (request_id, stage)
);

CREATE INDEX IF NOT EXISTS asset_generation_jobs_status ON asset_generation_jobs(status, queued_at);

INSERT INTO asset_generation_jobs(request_id,stage,status,error,queued_at,started_at,finished_at)
SELECT id,'thumbnail',
       CASE WHEN thumbnail_path IS NOT NULL THEN 'ready' WHEN assets_generated_at IS NOT NULL THEN 'failed' ELSE 'pending' END,
       CASE WHEN thumbnail_path IS NULL AND assets_generated_at IS NOT NULL THEN 'thumbnail was not generated' ELSE NULL END,
       created_at,NULL,COALESCE(assets_generated_at, NULL)
FROM requests;

INSERT INTO asset_generation_jobs(request_id,stage,status,error,queued_at,started_at,finished_at)
SELECT id,'preview',
       CASE WHEN preview_path IS NOT NULL THEN 'ready' WHEN assets_generated_at IS NOT NULL THEN 'skipped' ELSE 'pending' END,
       NULL,created_at,NULL,COALESCE(assets_generated_at, NULL)
FROM requests;
