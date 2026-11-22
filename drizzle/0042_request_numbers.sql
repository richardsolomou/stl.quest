ALTER TABLE `organization` ADD `last_request_number` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `consumables` ADD `slicer` text;--> statement-breakpoint
ALTER TABLE `printers` ADD `slicer` text;--> statement-breakpoint
ALTER TABLE `requests` ADD `number` integer;--> statement-breakpoint
CREATE UNIQUE INDEX `requests_workspace_number_unique` ON `requests` (`workspace_id`,`number`);