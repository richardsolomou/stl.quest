CREATE TABLE `managed_storage_accounts` (
	`owner_id` text PRIMARY KEY NOT NULL,
	`persisted_bytes` integer DEFAULT 0 NOT NULL,
	`asset_reserved_bytes` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`owner_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `managed_storage_entitlements` (
	`workspace_id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`owner_id`) REFERENCES `managed_storage_accounts`(`owner_id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `managed_storage_entitlements_owner` ON `managed_storage_entitlements` (`owner_id`);--> statement-breakpoint
CREATE TABLE `managed_storage_usage` (
	`workspace_id` text PRIMARY KEY NOT NULL,
	`persisted_bytes` integer DEFAULT 0 NOT NULL,
	`asset_reserved_bytes` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
ALTER TABLE `upload_sessions` ADD `finalizing_bytes` integer DEFAULT 0 NOT NULL;