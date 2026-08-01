ALTER TABLE "user_onboarding" ADD COLUMN "skipped_tasks" text DEFAULT '[]' NOT NULL;--> statement-breakpoint
ALTER TABLE "user_onboarding" ADD COLUMN "celebrated_tasks" text DEFAULT '[]' NOT NULL;--> statement-breakpoint
UPDATE "user_onboarding" SET "celebrated_tasks" = "completed_tasks";--> statement-breakpoint
ALTER TABLE "user_onboarding" DROP COLUMN "snoozed_until";
