ALTER TABLE "subscription" ALTER COLUMN "created_at" SET DEFAULT (now()::text);--> statement-breakpoint
ALTER TABLE "subscription" ALTER COLUMN "updated_at" SET DEFAULT (now()::text);