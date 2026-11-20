PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_requests` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`name` text NOT NULL,
	`file_name` text,
	`file_path` text,
	`quantity` integer NOT NULL,
	`owner_user_id` text NOT NULL,
	`notes` text,
	`source_url` text,
	`source_image_url` text,
	`source_image_path` text,
	`thumbnail_path` text,
	`preview_path` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`assets_generated_at` integer,
	`printer_id` text,
	`print_type` text,
	`automatic_printer_assignment` integer DEFAULT false NOT NULL,
	`model_width_mm` real,
	`model_depth_mm` real,
	`model_height_mm` real,
	`model_volume_mm3` real,
	`model_surface_area_mm2` real,
	`estimated_material_override` real,
	`estimated_print_minutes_override` real,
	`archived_at` integer,
	`unarchived_at` integer,
	FOREIGN KEY (`workspace_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`owner_user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`workspace_id`,`printer_id`) REFERENCES `printers`(`workspace_id`,`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "requests_print_type_check" CHECK("__new_requests"."print_type" IN ('resin', 'filament') OR "__new_requests"."print_type" IS NULL),
	CONSTRAINT "requests_model_source_check" CHECK(("__new_requests"."file_name" IS NOT NULL AND "__new_requests"."file_path" IS NOT NULL) OR ("__new_requests"."file_name" IS NULL AND "__new_requests"."file_path" IS NULL AND trim(coalesce("__new_requests"."source_url", '')) <> ''))
);
--> statement-breakpoint
INSERT INTO `__new_requests`("id", "workspace_id", "name", "file_name", "file_path", "quantity", "owner_user_id", "notes", "source_url", "source_image_url", "source_image_path", "thumbnail_path", "preview_path", "created_at", "updated_at", "assets_generated_at", "printer_id", "print_type", "automatic_printer_assignment", "model_width_mm", "model_depth_mm", "model_height_mm", "model_volume_mm3", "model_surface_area_mm2", "estimated_material_override", "estimated_print_minutes_override", "archived_at", "unarchived_at") SELECT "id", "workspace_id", "name", "file_name", "file_path", "quantity", "owner_user_id", "notes", "source_url", "source_image_url", "source_image_path", "thumbnail_path", "preview_path", "created_at", "updated_at", "assets_generated_at", "printer_id", "print_type", "automatic_printer_assignment", "model_width_mm", "model_depth_mm", "model_height_mm", "model_volume_mm3", "model_surface_area_mm2", "estimated_material_override", "estimated_print_minutes_override", "archived_at", "unarchived_at" FROM `requests`;--> statement-breakpoint
DROP TABLE `requests`;--> statement-breakpoint
ALTER TABLE `__new_requests` RENAME TO `requests`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `requests_created` ON `requests` (`created_at`);--> statement-breakpoint
CREATE INDEX `requests_workspace_created` ON `requests` (`workspace_id`,`created_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `requests_workspace_id_unique` ON `requests` (`workspace_id`,`id`);--> statement-breakpoint
CREATE INDEX `requests_print_type` ON `requests` (`print_type`);--> statement-breakpoint
CREATE INDEX `requests_printer_id` ON `requests` (`printer_id`);--> statement-breakpoint
CREATE INDEX `requests_owner_user_id` ON `requests` (`owner_user_id`);--> statement-breakpoint
CREATE TABLE `__new_usage_events` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`transaction_id` text NOT NULL,
	`stage` text NOT NULL,
	`kind` text NOT NULL,
	`request_id` text,
	`printer_id` text,
	`equipment_id` text,
	`consumable_id` text,
	`amount` real NOT NULL,
	`unit` text NOT NULL,
	`copies` integer,
	`outcome` text,
	`unit_price` real,
	`currency` text,
	`user_id` text,
	`created_at` integer NOT NULL,
	`undone_at` integer,
	FOREIGN KEY (`workspace_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`workspace_id`,`printer_id`) REFERENCES `printers`(`workspace_id`,`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`workspace_id`,`equipment_id`) REFERENCES `equipment`(`workspace_id`,`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`workspace_id`,`consumable_id`) REFERENCES `consumables`(`workspace_id`,`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "usage_events_stage_check" CHECK("__new_usage_events"."stage" IN ('printing', 'finishing', 'stock')),
	CONSTRAINT "usage_events_kind_check" CHECK("__new_usage_events"."kind" IN ('use', 'restock', 'correction', 'waste', 'replace')),
	CONSTRAINT "usage_events_unit_check" CHECK("__new_usage_events"."unit" IN ('ml', 'g', 'item', 'minute', 'plate')),
	CONSTRAINT "usage_events_outcome_check" CHECK("__new_usage_events"."outcome" IN ('completed', 'failed') OR "__new_usage_events"."outcome" IS NULL),
	CONSTRAINT "usage_events_copies_check" CHECK("__new_usage_events"."copies" > 0 OR "__new_usage_events"."copies" IS NULL)
);
--> statement-breakpoint
INSERT INTO `__new_usage_events`("id", "workspace_id", "transaction_id", "stage", "kind", "request_id", "printer_id", "equipment_id", "consumable_id", "amount", "unit", "copies", "outcome", "unit_price", "currency", "user_id", "created_at", "undone_at") SELECT "id", "workspace_id", "transaction_id", "stage", "kind", "request_id", "printer_id", "equipment_id", "consumable_id", "amount", "unit", "copies", "outcome", "unit_price", "currency", "user_id", "created_at", "undone_at" FROM `usage_events`;--> statement-breakpoint
DROP TABLE `usage_events`;--> statement-breakpoint
ALTER TABLE `__new_usage_events` RENAME TO `usage_events`;--> statement-breakpoint
CREATE INDEX `usage_events_request` ON `usage_events` (`workspace_id`,`request_id`);--> statement-breakpoint
CREATE INDEX `usage_events_consumable` ON `usage_events` (`workspace_id`,`consumable_id`);--> statement-breakpoint
CREATE INDEX `usage_events_transaction` ON `usage_events` (`workspace_id`,`transaction_id`);--> statement-breakpoint
CREATE INDEX `usage_events_created` ON `usage_events` (`workspace_id`,`created_at`);