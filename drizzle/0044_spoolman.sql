CREATE TABLE `spoolman_connections` (
	`workspace_id` text PRIMARY KEY NOT NULL,
	`token_hash` text NOT NULL,
	`created_at` integer NOT NULL,
	`received_at` integer,
	FOREIGN KEY (`workspace_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `spoolman_connections_token_hash_unique` ON `spoolman_connections` (`token_hash`);--> statement-breakpoint
CREATE TABLE `spoolman_links` (
	`workspace_id` text NOT NULL,
	`filament_id` integer NOT NULL,
	`consumable_id` text,
	`updated_at` integer NOT NULL,
	PRIMARY KEY(`workspace_id`, `filament_id`),
	FOREIGN KEY (`workspace_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`workspace_id`,`consumable_id`) REFERENCES `consumables`(`workspace_id`,`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `spoolman_spools` (
	`workspace_id` text NOT NULL,
	`id` integer NOT NULL,
	`filament_id` integer NOT NULL,
	`filament_name` text,
	`vendor` text,
	`material` text,
	`colour_hex` text,
	`external_id` text,
	`remaining_grams` real,
	`archived` integer DEFAULT false NOT NULL,
	`updated_at` integer NOT NULL,
	PRIMARY KEY(`workspace_id`, `id`),
	FOREIGN KEY (`workspace_id`) REFERENCES `spoolman_connections`(`workspace_id`) ON UPDATE no action ON DELETE cascade
);
