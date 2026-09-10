--> Better Auth 1.7 scopes account identity by issuer. SQLite cannot add a NOT NULL
--> column without a default, so rebuild `account` and derive `issuer` from `providerId`
--> the same way Better Auth does: `local:credential` for password accounts and
--> `local:oauth:<providerId>` for social providers without an issuer of their own.
ALTER TABLE `account` RENAME TO `__migration_account`;--> statement-breakpoint
CREATE TABLE `account` (
	`id` text PRIMARY KEY NOT NULL,
	`accountId` text NOT NULL,
	`issuer` text NOT NULL,
	`providerId` text NOT NULL,
	`userId` text NOT NULL,
	`accessToken` text,
	`refreshToken` text,
	`idToken` text,
	`accessTokenExpiresAt` text,
	`refreshTokenExpiresAt` text,
	`scope` text,
	`password` text,
	`createdAt` text NOT NULL,
	`updatedAt` text NOT NULL,
	FOREIGN KEY (`userId`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);--> statement-breakpoint
INSERT INTO `account` (
	`id`,
	`accountId`,
	`issuer`,
	`providerId`,
	`userId`,
	`accessToken`,
	`refreshToken`,
	`idToken`,
	`accessTokenExpiresAt`,
	`refreshTokenExpiresAt`,
	`scope`,
	`password`,
	`createdAt`,
	`updatedAt`
)
SELECT
	`id`,
	`accountId`,
	CASE WHEN `providerId` = 'credential' THEN 'local:credential' ELSE 'local:oauth:' || `providerId` END,
	`providerId`,
	`userId`,
	`accessToken`,
	`refreshToken`,
	`idToken`,
	`accessTokenExpiresAt`,
	`refreshTokenExpiresAt`,
	`scope`,
	`password`,
	`createdAt`,
	`updatedAt`
FROM `__migration_account`;--> statement-breakpoint
DROP TABLE `__migration_account`;--> statement-breakpoint
CREATE INDEX `account_userId_idx` ON `account` (`userId`);--> statement-breakpoint
CREATE UNIQUE INDEX `account_issuer_accountId_unique` ON `account` (`issuer`,`accountId`);
