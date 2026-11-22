CREATE TABLE `print_jobs` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`printer_name` text NOT NULL,
	`printer_id` text,
	`file_name` text,
	`outcome` text NOT NULL,
	`minutes` real,
	`grams` real,
	`filament_details` text,
	`reason` text,
	`progress` real,
	`archive_id` text,
	`run_id` text,
	`plate_id` text,
	`personal` integer DEFAULT false NOT NULL,
	`transaction_id` text,
	`started_at` integer,
	`ended_at` integer,
	`received_at` integer NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`workspace_id`,`printer_id`) REFERENCES `printers`(`workspace_id`,`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`workspace_id`,`plate_id`) REFERENCES `plates`(`workspace_id`,`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "print_jobs_outcome_check" CHECK("print_jobs"."outcome" IN ('printing', 'finished', 'failed', 'cancelled'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `print_jobs_workspace_id_unique` ON `print_jobs` (`workspace_id`,`id`);--> statement-breakpoint
CREATE INDEX `print_jobs_received` ON `print_jobs` (`workspace_id`,`received_at`);--> statement-breakpoint
CREATE INDEX `print_jobs_plate` ON `print_jobs` (`workspace_id`,`plate_id`);--> statement-breakpoint
ALTER TABLE `plates` ADD `status_id` text;--> statement-breakpoint
ALTER TABLE `plates` ADD `started_at` integer;--> statement-breakpoint
CREATE INDEX `plates_status` ON `plates` (`workspace_id`,`status_id`);