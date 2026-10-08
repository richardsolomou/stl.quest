CREATE TABLE `member_notification_preferences` (
	`workspace_id` text NOT NULL,
	`user_id` text NOT NULL,
	`kind` text NOT NULL,
	`enabled` integer NOT NULL,
	`updated_at` integer NOT NULL,
	PRIMARY KEY(`workspace_id`, `user_id`, `kind`),
	FOREIGN KEY (`workspace_id`,`user_id`) REFERENCES `member`(`organizationId`,`userId`) ON UPDATE no action ON DELETE cascade
);
