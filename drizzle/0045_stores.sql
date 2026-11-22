CREATE TABLE `stores` (
	`workspace_id` text NOT NULL,
	`id` text NOT NULL,
	`position` integer NOT NULL,
	`name` text NOT NULL,
	`shipping_cost` real,
	`free_shipping_over` real,
	`archived_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	PRIMARY KEY(`workspace_id`, `id`),
	FOREIGN KEY (`workspace_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `stores_position` ON `stores` (`workspace_id`,`position`);--> statement-breakpoint
ALTER TABLE `consumables` ADD `store_id` text;