ALTER TABLE `equipment` ADD `purchased_on` text;--> statement-breakpoint
ALTER TABLE `printers` ADD `purchased_on` text;--> statement-breakpoint
CREATE INDEX `usage_events_printer` ON `usage_events` (`workspace_id`,`printer_id`);