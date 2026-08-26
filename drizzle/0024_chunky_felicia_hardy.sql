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
	FOREIGN KEY (`workspace_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`owner_user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "requests_print_type_check" CHECK("__new_requests"."print_type" IN ('resin', 'filament') OR "__new_requests"."print_type" IS NULL),
	CONSTRAINT "requests_model_source_check" CHECK(("__new_requests"."file_name" IS NOT NULL AND "__new_requests"."file_path" IS NOT NULL) OR ("__new_requests"."file_name" IS NULL AND "__new_requests"."file_path" IS NULL AND trim(coalesce("__new_requests"."source_url", '')) <> ''))
);
--> statement-breakpoint
INSERT INTO `__new_requests`("id", "workspace_id", "name", "file_name", "file_path", "quantity", "owner_user_id", "notes", "source_url", "thumbnail_path", "preview_path", "created_at", "updated_at", "assets_generated_at", "printer_id", "print_type", "automatic_printer_assignment", "model_width_mm", "model_depth_mm", "model_height_mm", "model_volume_mm3", "model_surface_area_mm2", "estimated_material_override", "estimated_print_minutes_override", "archived_at") SELECT "id", "workspace_id", "name", "file_name", "file_path", "quantity", "owner_user_id", "notes", "source_url", "thumbnail_path", "preview_path", "created_at", "updated_at", "assets_generated_at", "printer_id", "print_type", "automatic_printer_assignment", "model_width_mm", "model_depth_mm", "model_height_mm", "model_volume_mm3", "model_surface_area_mm2", "estimated_material_override", "estimated_print_minutes_override", "archived_at" FROM `requests`;--> statement-breakpoint
DROP TABLE `requests`;--> statement-breakpoint
ALTER TABLE `__new_requests` RENAME TO `requests`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `requests_created` ON `requests` (`created_at`);--> statement-breakpoint
CREATE INDEX `requests_workspace_created` ON `requests` (`workspace_id`,`created_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `requests_workspace_id_unique` ON `requests` (`workspace_id`,`id`);--> statement-breakpoint
CREATE INDEX `requests_print_type` ON `requests` (`print_type`);--> statement-breakpoint
CREATE INDEX `requests_printer_id` ON `requests` (`printer_id`);--> statement-breakpoint
CREATE INDEX `requests_owner_user_id` ON `requests` (`owner_user_id`);