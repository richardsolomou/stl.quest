CREATE TABLE `consumables` (
	`workspace_id` text NOT NULL,
	`id` text NOT NULL,
	`position` integer NOT NULL,
	`kind` text NOT NULL,
	`name` text NOT NULL,
	`preset_id` text,
	`price` real NOT NULL,
	`density_grams_per_ml` real,
	`colour_json` text,
	`print_type` text,
	`lifespan` real,
	`lifespan_unit` text,
	`printer_preset_id` text,
	`printer_id` text,
	`unit` text,
	`minimum_stock` real,
	`pack_size` real,
	`archived_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	PRIMARY KEY(`workspace_id`, `id`),
	FOREIGN KEY (`workspace_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "consumables_kind_check" CHECK("consumables"."kind" IN ('resin', 'filament', 'part', 'supply')),
	CONSTRAINT "consumables_print_type_check" CHECK("consumables"."print_type" IN ('resin', 'filament') OR "consumables"."print_type" IS NULL),
	CONSTRAINT "consumables_lifespan_unit_check" CHECK("consumables"."lifespan_unit" IN ('plates', 'hours') OR "consumables"."lifespan_unit" IS NULL),
	CONSTRAINT "consumables_unit_check" CHECK("consumables"."unit" IN ('ml', 'g', 'item') OR "consumables"."unit" IS NULL)
);
--> statement-breakpoint
CREATE INDEX `consumables_position` ON `consumables` (`workspace_id`,`position`);--> statement-breakpoint
CREATE TABLE `equipment` (
	`workspace_id` text NOT NULL,
	`id` text NOT NULL,
	`position` integer NOT NULL,
	`name` text NOT NULL,
	`preset_id` text,
	`kind` text NOT NULL,
	`stage` text NOT NULL,
	`print_type` text,
	`power_watts` real NOT NULL,
	`minutes_per_use` real NOT NULL,
	`supplies_json` text DEFAULT '[]' NOT NULL,
	`purchase_price` real,
	`lifespan_hours` real,
	`archived_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	PRIMARY KEY(`workspace_id`, `id`),
	FOREIGN KEY (`workspace_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "equipment_kind_check" CHECK("equipment"."kind" IN ('wash', 'cure', 'wash-cure', 'oven', 'ultrasonic', 'dryer', 'other')),
	CONSTRAINT "equipment_stage_check" CHECK("equipment"."stage" IN ('before-printing', 'finishing')),
	CONSTRAINT "equipment_print_type_check" CHECK("equipment"."print_type" IN ('resin', 'filament') OR "equipment"."print_type" IS NULL)
);
--> statement-breakpoint
CREATE INDEX `equipment_position` ON `equipment` (`workspace_id`,`position`);--> statement-breakpoint
CREATE TABLE `printers` (
	`workspace_id` text NOT NULL,
	`id` text NOT NULL,
	`position` integer NOT NULL,
	`name` text NOT NULL,
	`print_type` text NOT NULL,
	`preset_id` text,
	`width_mm` real,
	`depth_mm` real,
	`height_mm` real,
	`purchase_price` real,
	`lifespan_hours` real,
	`power_watts` real,
	`add_on_preset_ids_json` text DEFAULT '[]' NOT NULL,
	`archived_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	PRIMARY KEY(`workspace_id`, `id`),
	FOREIGN KEY (`workspace_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "printers_print_type_check" CHECK("printers"."print_type" IN ('resin', 'filament'))
);
--> statement-breakpoint
CREATE INDEX `printers_position` ON `printers` (`workspace_id`,`position`);--> statement-breakpoint
CREATE TABLE `data_migrations` (
	`id` text PRIMARY KEY NOT NULL,
	`applied_at` integer NOT NULL
);
