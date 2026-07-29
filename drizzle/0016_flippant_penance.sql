PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_subscription` (
	`id` text PRIMARY KEY NOT NULL,
	`plan` text NOT NULL,
	`reference_id` text NOT NULL,
	`stripe_customer_id` text,
	`stripe_subscription_id` text,
	`status` text DEFAULT 'incomplete' NOT NULL,
	`period_start` text,
	`period_end` text,
	`trial_start` text,
	`trial_end` text,
	`cancel_at_period_end` integer DEFAULT false NOT NULL,
	`cancel_at` text,
	`canceled_at` text,
	`ended_at` text,
	`seats` integer,
	`billing_interval` text,
	`stripe_schedule_id` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
);
--> statement-breakpoint
INSERT INTO `__new_subscription`("id", "plan", "reference_id", "stripe_customer_id", "stripe_subscription_id", "status", "period_start", "period_end", "trial_start", "trial_end", "cancel_at_period_end", "cancel_at", "canceled_at", "ended_at", "seats", "billing_interval", "stripe_schedule_id", "created_at", "updated_at") SELECT "id", "plan", "reference_id", "stripe_customer_id", "stripe_subscription_id", "status", "period_start", "period_end", "trial_start", "trial_end", "cancel_at_period_end", "cancel_at", "canceled_at", "ended_at", "seats", "billing_interval", "stripe_schedule_id", "created_at", "updated_at" FROM `subscription`;--> statement-breakpoint
DROP TABLE `subscription`;--> statement-breakpoint
ALTER TABLE `__new_subscription` RENAME TO `subscription`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `subscription_referenceId_idx` ON `subscription` (`reference_id`);--> statement-breakpoint
CREATE INDEX `subscription_stripeCustomerId_idx` ON `subscription` (`stripe_customer_id`);