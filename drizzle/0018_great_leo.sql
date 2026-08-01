CREATE TABLE `user_onboarding` (
	`user_id` text PRIMARY KEY NOT NULL,
	`completed_tasks` text DEFAULT '[]' NOT NULL,
	`skipped_tasks` text DEFAULT '[]' NOT NULL,
	`celebrated_tasks` text DEFAULT '[]' NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `workspace_onboarding` (
	`workspace_id` text NOT NULL,
	`user_id` text NOT NULL,
	`completed_tasks` text DEFAULT '[]' NOT NULL,
	`skipped_tasks` text DEFAULT '[]' NOT NULL,
	`celebrated_tasks` text DEFAULT '[]' NOT NULL,
	`updated_at` integer NOT NULL,
	PRIMARY KEY(`workspace_id`, `user_id`),
	FOREIGN KEY (`workspace_id`,`user_id`) REFERENCES `member`(`organizationId`,`userId`) ON UPDATE no action ON DELETE cascade
);
