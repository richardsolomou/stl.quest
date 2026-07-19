INSERT INTO `asset_generation_jobs` (`workspace_id`, `request_id`, `stage`, `status`, `error`, `queued_at`, `started_at`, `finished_at`)
SELECT `workspace_id`, `id`, 'preview', 'pending', NULL, CAST(strftime('%s', 'now') AS INTEGER) * 1000, NULL, NULL
FROM `requests`
WHERE `preview_path` IS NOT NULL
ON CONFLICT (`workspace_id`, `request_id`, `stage`) DO UPDATE SET
  `status` = 'pending',
  `error` = NULL,
  `queued_at` = excluded.`queued_at`,
  `started_at` = NULL,
  `finished_at` = NULL;--> statement-breakpoint
UPDATE `requests`
SET `assets_generated_at` = NULL
WHERE `preview_path` IS NOT NULL;
