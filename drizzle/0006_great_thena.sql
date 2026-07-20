ALTER TABLE `requests` ADD `automatic_printer_assignment` integer DEFAULT false NOT NULL;--> statement-breakpoint
UPDATE `requests` SET `automatic_printer_assignment` = true WHERE `print_type` IS NOT NULL;--> statement-breakpoint
ALTER TABLE `requests` ADD `model_width_mm` real;--> statement-breakpoint
ALTER TABLE `requests` ADD `model_depth_mm` real;--> statement-breakpoint
ALTER TABLE `requests` ADD `model_height_mm` real;
