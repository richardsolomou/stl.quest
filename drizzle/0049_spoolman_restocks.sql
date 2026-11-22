CREATE TABLE `spoolman_restocks` (
	`workspace_id` text NOT NULL,
	`id` text NOT NULL,
	`filament_id` integer NOT NULL,
	`filament_name` text,
	`grams` real,
	`status` text NOT NULL,
	`spool_id` integer,
	`error` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	PRIMARY KEY(`workspace_id`, `id`),
	FOREIGN KEY (`workspace_id`) REFERENCES `spoolman_connections`(`workspace_id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "spoolman_restocks_status_check" CHECK("spoolman_restocks"."status" IN ('queued', 'created', 'failed'))
);
--> statement-breakpoint
CREATE INDEX `spoolman_restocks_status` ON `spoolman_restocks` (`workspace_id`,`status`,`created_at`);--> statement-breakpoint
ALTER TABLE `print_jobs` ADD `filament_usage` text;