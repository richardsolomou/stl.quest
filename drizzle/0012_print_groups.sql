CREATE TABLE `print_group_items` (
	`workspace_id` text NOT NULL,
	`group_id` text NOT NULL,
	`request_id` text NOT NULL,
	`quantity` integer NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	PRIMARY KEY(`workspace_id`, `group_id`, `request_id`),
	FOREIGN KEY (`workspace_id`,`group_id`) REFERENCES `print_groups`(`workspace_id`,`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`workspace_id`,`request_id`) REFERENCES `requests`(`workspace_id`,`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "print_group_items_quantity_check" CHECK("print_group_items"."quantity" > 0)
);
--> statement-breakpoint
CREATE TABLE `print_groups` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`name` text NOT NULL,
	`status_id` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `print_groups_workspace_id_unique` ON `print_groups` (`workspace_id`,`id`);--> statement-breakpoint
CREATE INDEX `print_groups_status` ON `print_groups` (`workspace_id`,`status_id`);