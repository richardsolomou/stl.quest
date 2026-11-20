CREATE TABLE `plate_items` (
	`workspace_id` text NOT NULL,
	`plate_id` text NOT NULL,
	`request_id` text NOT NULL,
	`copies` integer NOT NULL,
	`amount` real,
	`minutes` real,
	PRIMARY KEY(`workspace_id`, `plate_id`, `request_id`),
	FOREIGN KEY (`workspace_id`,`plate_id`) REFERENCES `plates`(`workspace_id`,`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`workspace_id`,`request_id`) REFERENCES `requests`(`workspace_id`,`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "plate_items_copies_check" CHECK("plate_items"."copies" > 0)
);
--> statement-breakpoint
CREATE INDEX `plate_items_request` ON `plate_items` (`workspace_id`,`request_id`);--> statement-breakpoint
CREATE TABLE `plates` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`number` integer NOT NULL,
	`printer_id` text,
	`other_stuff` integer DEFAULT false NOT NULL,
	`transaction_id` text,
	`source` text,
	`method` text,
	`unit` text,
	`minutes` real,
	`other_amount` real,
	`overhead_amount` real,
	`recorded_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`workspace_id`,`printer_id`) REFERENCES `printers`(`workspace_id`,`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "plates_source_check" CHECK("plates"."source" IN ('file', 'totals') OR "plates"."source" IS NULL),
	CONSTRAINT "plates_method_check" CHECK("plates"."method" IN ('measured', 'volume', 'estimate', 'even') OR "plates"."method" IS NULL),
	CONSTRAINT "plates_unit_check" CHECK("plates"."unit" IN ('g', 'ml') OR "plates"."unit" IS NULL)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `plates_workspace_id_unique` ON `plates` (`workspace_id`,`id`);--> statement-breakpoint
CREATE UNIQUE INDEX `plates_workspace_number_unique` ON `plates` (`workspace_id`,`number`);--> statement-breakpoint
ALTER TABLE `requests` ADD `charged_amount` real;--> statement-breakpoint
ALTER TABLE `requests` ADD `charged_currency` text;--> statement-breakpoint
ALTER TABLE `usage_events` ADD `plate_id` text;--> statement-breakpoint
ALTER TABLE `usage_events` ADD `superseded_by` text;--> statement-breakpoint
CREATE INDEX `usage_events_superseded` ON `usage_events` (`workspace_id`,`superseded_by`);