PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_upload_sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`owner_id` text NOT NULL,
	`bytes` integer DEFAULT 0 NOT NULL,
	`expires_at` integer NOT NULL,
	`completed_request_id` text,
	FOREIGN KEY (`workspace_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`owner_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`workspace_id`,`completed_request_id`) REFERENCES `requests`(`workspace_id`,`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `__new_upload_sessions`("id", "workspace_id", "owner_id", "bytes", "expires_at", "completed_request_id") SELECT "id", "workspace_id", "owner_id", "bytes", "expires_at", CASE WHEN "completed_request_id" IS NULL OR EXISTS (SELECT 1 FROM `requests` WHERE `requests`.`workspace_id` = `upload_sessions`.`workspace_id` AND `requests`.`id` = `upload_sessions`.`completed_request_id`) THEN "completed_request_id" ELSE NULL END FROM `upload_sessions`;--> statement-breakpoint
DROP TABLE `upload_sessions`;--> statement-breakpoint
ALTER TABLE `__new_upload_sessions` RENAME TO `upload_sessions`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `upload_sessions_owner` ON `upload_sessions` (`workspace_id`,`owner_id`,`expires_at`);--> statement-breakpoint
DROP INDEX `operations_active_request`;--> statement-breakpoint
DROP INDEX `operations_upload`;--> statement-breakpoint
CREATE UNIQUE INDEX `operations_active_request` ON `operations` (`workspace_id`,`request_id`) WHERE "operations"."request_id" IS NOT NULL AND "operations"."state" <> 'committed';--> statement-breakpoint
CREATE UNIQUE INDEX `operations_upload` ON `operations` (`workspace_id`,`upload_id`) WHERE "operations"."upload_id" IS NOT NULL;
