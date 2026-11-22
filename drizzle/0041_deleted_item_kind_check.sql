PRAGMA foreign_keys=OFF;--> statement-breakpoint
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
	`estimated` integer DEFAULT false NOT NULL,
	`user_id` text,
	`created_at` integer NOT NULL,
	`undone_at` integer,
	`plate_id` text,
	`superseded_by` text,
	`deleted_item_name` text,
	`deleted_item_kind` text,
	FOREIGN KEY (`workspace_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`workspace_id`,`printer_id`) REFERENCES `printers`(`workspace_id`,`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`workspace_id`,`equipment_id`) REFERENCES `equipment`(`workspace_id`,`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`workspace_id`,`consumable_id`) REFERENCES `consumables`(`workspace_id`,`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "usage_events_stage_check" CHECK("__new_usage_events"."stage" IN ('printing', 'finishing', 'stock')),
	CONSTRAINT "usage_events_kind_check" CHECK("__new_usage_events"."kind" IN ('use', 'restock', 'correction', 'waste', 'replace')),
	CONSTRAINT "usage_events_unit_check" CHECK("__new_usage_events"."unit" IN ('ml', 'g', 'item', 'minute', 'plate')),
	CONSTRAINT "usage_events_outcome_check" CHECK("__new_usage_events"."outcome" IN ('completed', 'failed') OR "__new_usage_events"."outcome" IS NULL),
	CONSTRAINT "usage_events_copies_check" CHECK("__new_usage_events"."copies" > 0 OR "__new_usage_events"."copies" IS NULL),
	CONSTRAINT "usage_events_deleted_item_kind_check" CHECK("__new_usage_events"."deleted_item_kind" IN ('printer', 'equipment', 'resin', 'filament', 'part', 'supply') OR "__new_usage_events"."deleted_item_kind" IS NULL)
);
--> statement-breakpoint
INSERT INTO `__new_usage_events`("id", "workspace_id", "transaction_id", "stage", "kind", "request_id", "printer_id", "equipment_id", "consumable_id", "amount", "unit", "copies", "outcome", "unit_price", "currency", "estimated", "user_id", "created_at", "undone_at", "plate_id", "superseded_by", "deleted_item_name", "deleted_item_kind") SELECT "id", "workspace_id", "transaction_id", "stage", "kind", "request_id", "printer_id", "equipment_id", "consumable_id", "amount", "unit", "copies", "outcome", "unit_price", "currency", "estimated", "user_id", "created_at", "undone_at", "plate_id", "superseded_by", "deleted_item_name", "deleted_item_kind" FROM `usage_events`;--> statement-breakpoint
DROP TABLE `usage_events`;--> statement-breakpoint
ALTER TABLE `__new_usage_events` RENAME TO `usage_events`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `usage_events_request` ON `usage_events` (`workspace_id`,`request_id`);--> statement-breakpoint
CREATE INDEX `usage_events_consumable` ON `usage_events` (`workspace_id`,`consumable_id`);--> statement-breakpoint
CREATE INDEX `usage_events_transaction` ON `usage_events` (`workspace_id`,`transaction_id`);--> statement-breakpoint
CREATE INDEX `usage_events_created` ON `usage_events` (`workspace_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `usage_events_superseded` ON `usage_events` (`workspace_id`,`superseded_by`);