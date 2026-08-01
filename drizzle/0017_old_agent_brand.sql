CREATE TABLE `user_onboarding` (
	`user_id` text PRIMARY KEY NOT NULL,
	`completed_tasks` text DEFAULT '[]' NOT NULL,
	`snoozed_until` integer,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
