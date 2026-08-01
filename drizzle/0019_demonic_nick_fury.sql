PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_print_group_items` (
	`workspace_id` text NOT NULL,
	`group_id` text NOT NULL,
	`request_id` text NOT NULL,
	`status_id` text NOT NULL,
	`quantity` integer NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	PRIMARY KEY(`workspace_id`, `group_id`, `request_id`, `status_id`),
	FOREIGN KEY (`workspace_id`,`group_id`) REFERENCES `print_groups`(`workspace_id`,`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`workspace_id`,`request_id`) REFERENCES `requests`(`workspace_id`,`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "print_group_items_quantity_check" CHECK("__new_print_group_items"."quantity" > 0)
);
--> statement-breakpoint
INSERT INTO `__new_print_group_items`("workspace_id", "group_id", "request_id", "status_id", "quantity", "sort_order") SELECT items."workspace_id", items."group_id", items."request_id", groups."status_id", items."quantity", items."sort_order" FROM `print_group_items` items INNER JOIN `print_groups` groups ON groups."workspace_id" = items."workspace_id" AND groups."id" = items."group_id";--> statement-breakpoint
DROP TABLE `print_group_items`;--> statement-breakpoint
ALTER TABLE `__new_print_group_items` RENAME TO `print_group_items`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE TABLE `__new_print_groups` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`name` text NOT NULL,
	`color` text DEFAULT 'blue' NOT NULL,
	`parent_id` text,
	`status_id` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`workspace_id`,`parent_id`) REFERENCES `print_groups`(`workspace_id`,`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `__new_print_groups`("id", "workspace_id", "name", "color", "parent_id", "status_id", "created_at", "updated_at") SELECT "id", "workspace_id", "name", "color", NULL, "status_id", "created_at", "updated_at" FROM `print_groups`;--> statement-breakpoint
DROP TABLE `print_groups`;--> statement-breakpoint
ALTER TABLE `__new_print_groups` RENAME TO `print_groups`;--> statement-breakpoint
CREATE UNIQUE INDEX `print_groups_workspace_id_unique` ON `print_groups` (`workspace_id`,`id`);--> statement-breakpoint
CREATE INDEX `print_groups_status` ON `print_groups` (`workspace_id`,`status_id`);
