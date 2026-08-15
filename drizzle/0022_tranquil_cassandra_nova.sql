PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_asset_generation_jobs` (
	`workspace_id` text NOT NULL,
	`request_id` text NOT NULL,
	`stage` text NOT NULL,
	`status` text NOT NULL,
	`error` text,
	`queued_at` integer NOT NULL,
	`started_at` integer,
	`finished_at` integer,
	PRIMARY KEY(`workspace_id`, `request_id`, `stage`),
	FOREIGN KEY (`workspace_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`workspace_id`,`request_id`) REFERENCES `requests`(`workspace_id`,`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "asset_generation_jobs_stage_check" CHECK("__new_asset_generation_jobs"."stage" IN ('geometry', 'thumbnail', 'preview')),
	CONSTRAINT "asset_generation_jobs_status_check" CHECK("__new_asset_generation_jobs"."status" IN ('pending', 'running', 'ready', 'skipped', 'failed'))
);
--> statement-breakpoint
INSERT INTO `__new_asset_generation_jobs`("workspace_id", "request_id", "stage", "status", "error", "queued_at", "started_at", "finished_at") SELECT "workspace_id", "request_id", "stage", "status", "error", "queued_at", "started_at", "finished_at" FROM `asset_generation_jobs`;--> statement-breakpoint
DROP TABLE `asset_generation_jobs`;--> statement-breakpoint
ALTER TABLE `__new_asset_generation_jobs` RENAME TO `asset_generation_jobs`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `asset_generation_jobs_workspace_status` ON `asset_generation_jobs` (`workspace_id`,`status`,`queued_at`);--> statement-breakpoint
INSERT OR IGNORE INTO `asset_generation_jobs` (`workspace_id`, `request_id`, `stage`, `status`, `queued_at`)
SELECT `workspace_id`, `id`, 'geometry', 'pending', CAST(unixepoch('subsec') * 1000 AS integer)
FROM `requests`
WHERE `model_volume_mm3` IS NULL OR `model_surface_area_mm2` IS NULL;
