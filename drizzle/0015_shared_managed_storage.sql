CREATE TABLE `managed_storage_accounts` (
	`owner_id` text PRIMARY KEY NOT NULL,
	`persisted_bytes` integer DEFAULT 0 NOT NULL,
	`asset_reserved_bytes` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`owner_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `managed_storage_accounts` (`owner_id`, `persisted_bytes`, `asset_reserved_bytes`)
SELECT `managed_storage_entitlements`.`owner_id`, coalesce(sum(`managed_storage_usage`.`persisted_bytes`), 0), coalesce(sum(`managed_storage_usage`.`asset_reserved_bytes`), 0)
FROM `managed_storage_entitlements`
LEFT JOIN `managed_storage_usage` ON `managed_storage_usage`.`workspace_id` = `managed_storage_entitlements`.`workspace_id`
GROUP BY `managed_storage_entitlements`.`owner_id`;--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_managed_storage_entitlements` (
	`workspace_id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`owner_id`) REFERENCES `managed_storage_accounts`(`owner_id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `__new_managed_storage_entitlements`("workspace_id", "owner_id") SELECT "workspace_id", "owner_id" FROM `managed_storage_entitlements`;--> statement-breakpoint
DROP TABLE `managed_storage_entitlements`;--> statement-breakpoint
ALTER TABLE `__new_managed_storage_entitlements` RENAME TO `managed_storage_entitlements`;--> statement-breakpoint
PRAGMA foreign_keys=ON;
