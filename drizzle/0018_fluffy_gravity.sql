PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_user_onboarding` (
	`user_id` text PRIMARY KEY NOT NULL,
	`completed_tasks` text DEFAULT '[]' NOT NULL,
	`skipped_tasks` text DEFAULT '[]' NOT NULL,
	`celebrated_tasks` text DEFAULT '[]' NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `__new_user_onboarding`("user_id", "completed_tasks", "skipped_tasks", "celebrated_tasks", "updated_at") SELECT "user_id", "completed_tasks", '[]', "completed_tasks", "updated_at" FROM `user_onboarding`;--> statement-breakpoint
DROP TABLE `user_onboarding`;--> statement-breakpoint
ALTER TABLE `__new_user_onboarding` RENAME TO `user_onboarding`;--> statement-breakpoint
PRAGMA foreign_keys=ON;
