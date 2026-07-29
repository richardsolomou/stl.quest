CREATE TABLE "subscription" (
	"id" text PRIMARY KEY NOT NULL,
	"plan" text NOT NULL,
	"reference_id" text NOT NULL,
	"stripe_customer_id" text,
	"stripe_subscription_id" text,
	"status" text DEFAULT 'incomplete' NOT NULL,
	"period_start" text,
	"period_end" text,
	"trial_start" text,
	"trial_end" text,
	"cancel_at_period_end" integer DEFAULT 0 NOT NULL,
	"cancel_at" text,
	"canceled_at" text,
	"ended_at" text,
	"seats" integer,
	"billing_interval" text,
	"stripe_schedule_id" text,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "stripe_customer_id" text;--> statement-breakpoint
CREATE INDEX "subscription_referenceId_idx" ON "subscription" USING btree ("reference_id");--> statement-breakpoint
CREATE INDEX "subscription_stripeCustomerId_idx" ON "subscription" USING btree ("stripe_customer_id");