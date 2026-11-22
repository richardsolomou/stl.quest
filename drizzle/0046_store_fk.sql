PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_consumables` (
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
	`slicer` text,
	`minimum_stock` real,
	`pack_size` real,
	`store_id` text,
	`archived_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	PRIMARY KEY(`workspace_id`, `id`),
	FOREIGN KEY (`workspace_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`workspace_id`,`store_id`) REFERENCES `stores`(`workspace_id`,`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "consumables_kind_check" CHECK("__new_consumables"."kind" IN ('resin', 'filament', 'part', 'supply')),
	CONSTRAINT "consumables_print_type_check" CHECK("__new_consumables"."print_type" IN ('resin', 'filament') OR "__new_consumables"."print_type" IS NULL),
	CONSTRAINT "consumables_lifespan_unit_check" CHECK("__new_consumables"."lifespan_unit" IN ('plates', 'hours') OR "__new_consumables"."lifespan_unit" IS NULL),
	CONSTRAINT "consumables_unit_check" CHECK("__new_consumables"."unit" IN ('ml', 'g', 'item') OR "__new_consumables"."unit" IS NULL)
);
--> statement-breakpoint
INSERT INTO `__new_consumables`("workspace_id", "id", "position", "kind", "name", "preset_id", "price", "density_grams_per_ml", "colour_json", "print_type", "lifespan", "lifespan_unit", "printer_preset_id", "printer_id", "unit", "slicer", "minimum_stock", "pack_size", "store_id", "archived_at", "created_at", "updated_at") SELECT "workspace_id", "id", "position", "kind", "name", "preset_id", "price", "density_grams_per_ml", "colour_json", "print_type", "lifespan", "lifespan_unit", "printer_preset_id", "printer_id", "unit", "slicer", "minimum_stock", "pack_size", "store_id", "archived_at", "created_at", "updated_at" FROM `consumables`;--> statement-breakpoint
DROP TABLE `consumables`;--> statement-breakpoint
ALTER TABLE `__new_consumables` RENAME TO `consumables`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `consumables_position` ON `consumables` (`workspace_id`,`position`);