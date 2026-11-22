PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_plates` (
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
	`status_id` text,
	`started_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`workspace_id`,`printer_id`) REFERENCES `printers`(`workspace_id`,`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "plates_source_check" CHECK("__new_plates"."source" IN ('file', 'totals', 'printer') OR "__new_plates"."source" IS NULL),
	CONSTRAINT "plates_status_check" CHECK("__new_plates"."status_id" IN ('in_progress', 'post_processing') OR "__new_plates"."status_id" IS NULL),
	CONSTRAINT "plates_method_check" CHECK("__new_plates"."method" IN ('measured', 'volume', 'estimate', 'even') OR "__new_plates"."method" IS NULL),
	CONSTRAINT "plates_unit_check" CHECK("__new_plates"."unit" IN ('g', 'ml') OR "__new_plates"."unit" IS NULL)
);
--> statement-breakpoint
INSERT INTO `__new_plates`("id", "workspace_id", "number", "printer_id", "other_stuff", "transaction_id", "source", "method", "unit", "minutes", "other_amount", "overhead_amount", "recorded_at", "status_id", "started_at", "created_at", "updated_at") SELECT "id", "workspace_id", "number", "printer_id", "other_stuff", "transaction_id", "source", "method", "unit", "minutes", "other_amount", "overhead_amount", "recorded_at", "status_id", "started_at", "created_at", "updated_at" FROM `plates`;--> statement-breakpoint
DROP TABLE `plates`;--> statement-breakpoint
ALTER TABLE `__new_plates` RENAME TO `plates`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `plates_workspace_id_unique` ON `plates` (`workspace_id`,`id`);--> statement-breakpoint
CREATE UNIQUE INDEX `plates_workspace_number_unique` ON `plates` (`workspace_id`,`number`);--> statement-breakpoint
CREATE INDEX `plates_status` ON `plates` (`workspace_id`,`status_id`);