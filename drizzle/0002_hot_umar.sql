CREATE TABLE `organization` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`slug` text NOT NULL,
	`logo` text,
	`createdAt` text NOT NULL,
	`metadata` text,
	`personal_owner_id` text,
	FOREIGN KEY (`personal_owner_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null
);--> statement-breakpoint
CREATE UNIQUE INDEX `organization_slug_unique` ON `organization` (`slug`);--> statement-breakpoint
CREATE UNIQUE INDEX `organization_personal_owner_unique` ON `organization` (`personal_owner_id`);--> statement-breakpoint
INSERT INTO `organization` (`id`, `name`, `slug`, `createdAt`)
SELECT 'legacy-workspace', 'PrintHub', 'printhub', strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
WHERE EXISTS (SELECT 1 FROM `user`) OR EXISTS (SELECT 1 FROM `requests`) OR EXISTS (SELECT 1 FROM `settings`);--> statement-breakpoint
CREATE TABLE `member` (
	`id` text PRIMARY KEY NOT NULL,
	`organizationId` text NOT NULL,
	`userId` text NOT NULL,
	`role` text DEFAULT 'member' NOT NULL,
	`createdAt` text NOT NULL,
	FOREIGN KEY (`organizationId`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`userId`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);--> statement-breakpoint
CREATE UNIQUE INDEX `member_organization_user_unique` ON `member` (`organizationId`,`userId`);--> statement-breakpoint
CREATE INDEX `member_organization_idx` ON `member` (`organizationId`);--> statement-breakpoint
CREATE INDEX `member_user_idx` ON `member` (`userId`);--> statement-breakpoint
INSERT INTO `member` (`id`, `organizationId`, `userId`, `role`, `createdAt`)
SELECT
	'legacy-member-' || `id`,
	'legacy-workspace',
	`id`,
	CASE
		WHEN `id` = COALESCE(
			(SELECT `id` FROM `user` WHERE `role` = 'admin' ORDER BY `createdAt`, `id` LIMIT 1),
			(SELECT `id` FROM `user` ORDER BY `createdAt`, `id` LIMIT 1)
		) THEN 'owner'
		WHEN `role` = 'admin' THEN 'admin'
		ELSE 'member'
	END,
	`createdAt`
FROM `user`
WHERE EXISTS (SELECT 1 FROM `organization` WHERE `id` = 'legacy-workspace');--> statement-breakpoint
CREATE TABLE `invitation` (
	`id` text PRIMARY KEY NOT NULL,
	`organizationId` text NOT NULL,
	`email` text NOT NULL,
	`role` text,
	`status` text DEFAULT 'pending' NOT NULL,
	`expiresAt` text NOT NULL,
	`createdAt` text NOT NULL,
	`inviterId` text NOT NULL,
	FOREIGN KEY (`organizationId`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`inviterId`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);--> statement-breakpoint
CREATE INDEX `invitation_organization_idx` ON `invitation` (`organizationId`);--> statement-breakpoint
CREATE INDEX `invitation_email_idx` ON `invitation` (`email`);--> statement-breakpoint
CREATE TABLE `deployment_settings` (
	`key` text PRIMARY KEY NOT NULL,
	`value_json` text NOT NULL,
	`updated_at` integer NOT NULL
);--> statement-breakpoint
INSERT INTO `deployment_settings` (`key`, `value_json`, `updated_at`)
SELECT `key`, `value_json`, `updated_at` FROM `settings` WHERE `key` IN ('authSecret', 'integrations', 'telemetry');--> statement-breakpoint
CREATE TABLE `__new_settings` (
	`workspace_id` text NOT NULL,
	`key` text NOT NULL,
	`value_json` text NOT NULL,
	`updated_at` integer NOT NULL,
	PRIMARY KEY(`workspace_id`, `key`),
	FOREIGN KEY (`workspace_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade
);--> statement-breakpoint
INSERT INTO `__new_settings` (`workspace_id`, `key`, `value_json`, `updated_at`)
SELECT 'legacy-workspace', `key`, `value_json`, `updated_at` FROM `settings` WHERE `key` NOT IN ('authSecret', 'integrations', 'telemetry');--> statement-breakpoint
DROP TABLE `settings`;--> statement-breakpoint
ALTER TABLE `__new_settings` RENAME TO `settings`;--> statement-breakpoint
CREATE TABLE `__new_requests` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`name` text NOT NULL,
	`file_name` text NOT NULL,
	`file_path` text NOT NULL,
	`quantity` integer NOT NULL,
	`owner_user_id` text NOT NULL,
	`notes` text,
	`source_url` text,
	`thumbnail_path` text,
	`preview_path` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`assets_generated_at` integer,
	`printer_id` text,
	`print_type` text,
	FOREIGN KEY (`workspace_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`owner_user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "requests_print_type_check" CHECK("__new_requests"."print_type" IN ('resin', 'filament') OR "__new_requests"."print_type" IS NULL)
);--> statement-breakpoint
INSERT INTO `__new_requests` (`id`, `workspace_id`, `name`, `file_name`, `file_path`, `quantity`, `owner_user_id`, `notes`, `source_url`, `thumbnail_path`, `preview_path`, `created_at`, `updated_at`, `assets_generated_at`, `printer_id`, `print_type`)
SELECT `id`, 'legacy-workspace', `name`, `file_name`, `file_path`, `quantity`, `owner_user_id`, `notes`, `source_url`, `thumbnail_path`, `preview_path`, `created_at`, `updated_at`, `assets_generated_at`, `printer_id`, `print_type` FROM `requests`;--> statement-breakpoint
DROP TABLE `requests`;--> statement-breakpoint
ALTER TABLE `__new_requests` RENAME TO `requests`;--> statement-breakpoint
CREATE INDEX `requests_created` ON `requests` (`created_at`);--> statement-breakpoint
CREATE INDEX `requests_workspace_created` ON `requests` (`workspace_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `requests_print_type` ON `requests` (`print_type`);--> statement-breakpoint
CREATE INDEX `requests_printer_id` ON `requests` (`printer_id`);--> statement-breakpoint
CREATE INDEX `requests_owner_user_id` ON `requests` (`owner_user_id`);--> statement-breakpoint
CREATE TABLE `__new_operations` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`kind` text NOT NULL,
	`request_id` text,
	`upload_id` text,
	`payload_json` text NOT NULL,
	`state` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "operations_kind_check" CHECK("__new_operations"."kind" IN ('move', 'delete', 'upload')),
	CONSTRAINT "operations_state_check" CHECK("__new_operations"."state" IN ('prepared', 'assets_moved', 'committed'))
);--> statement-breakpoint
INSERT INTO `__new_operations` (`id`, `workspace_id`, `kind`, `request_id`, `upload_id`, `payload_json`, `state`, `created_at`, `updated_at`)
SELECT `id`, 'legacy-workspace', `kind`, `request_id`, `upload_id`, `payload_json`, `state`, `created_at`, `updated_at` FROM `operations`;--> statement-breakpoint
DROP TABLE `operations`;--> statement-breakpoint
ALTER TABLE `__new_operations` RENAME TO `operations`;--> statement-breakpoint
CREATE INDEX `operations_state` ON `operations` (`state`,`created_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `operations_active_request` ON `operations` (`request_id`) WHERE `request_id` IS NOT NULL AND `state` <> 'committed';--> statement-breakpoint
CREATE UNIQUE INDEX `operations_upload` ON `operations` (`upload_id`) WHERE `upload_id` IS NOT NULL;--> statement-breakpoint
CREATE TABLE `__new_upload_sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`owner_id` text NOT NULL,
	`bytes` integer DEFAULT 0 NOT NULL,
	`expires_at` integer NOT NULL,
	`completed_request_id` text,
	FOREIGN KEY (`workspace_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`owner_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`completed_request_id`) REFERENCES `requests`(`id`) ON UPDATE no action ON DELETE cascade
);--> statement-breakpoint
INSERT INTO `__new_upload_sessions` (`id`, `workspace_id`, `owner_id`, `bytes`, `expires_at`, `completed_request_id`)
SELECT `id`, 'legacy-workspace', `owner_id`, `bytes`, `expires_at`, `completed_request_id` FROM `upload_sessions`;--> statement-breakpoint
DROP TABLE `upload_sessions`;--> statement-breakpoint
ALTER TABLE `__new_upload_sessions` RENAME TO `upload_sessions`;--> statement-breakpoint
CREATE INDEX `upload_sessions_owner` ON `upload_sessions` (`workspace_id`,`owner_id`,`expires_at`);--> statement-breakpoint
CREATE TABLE `__new_invites` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`token_hash` text NOT NULL,
	`role` text NOT NULL,
	`label` text,
	`recipient_email` text,
	`created_at` integer NOT NULL,
	`expires_at` integer NOT NULL,
	`used_at` integer,
	`used_by` text,
	FOREIGN KEY (`workspace_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "invites_role_check" CHECK("__new_invites"."role" IN ('admin', 'requester'))
);--> statement-breakpoint
INSERT INTO `__new_invites` (`id`, `workspace_id`, `token_hash`, `role`, `label`, `recipient_email`, `created_at`, `expires_at`, `used_at`, `used_by`)
SELECT `id`, 'legacy-workspace', `token_hash`, `role`, `label`, NULL, `created_at`, `expires_at`, `used_at`, `used_by` FROM `invites`;--> statement-breakpoint
DROP TABLE `invites`;--> statement-breakpoint
ALTER TABLE `__new_invites` RENAME TO `invites`;--> statement-breakpoint
CREATE UNIQUE INDEX `invites_token_hash_unique` ON `invites` (`token_hash`);--> statement-breakpoint
ALTER TABLE `session` ADD `activeOrganizationId` text;--> statement-breakpoint
UPDATE `session` SET `activeOrganizationId` = 'legacy-workspace' WHERE EXISTS (SELECT 1 FROM `member` WHERE `member`.`userId` = `session`.`userId` AND `member`.`organizationId` = 'legacy-workspace');
