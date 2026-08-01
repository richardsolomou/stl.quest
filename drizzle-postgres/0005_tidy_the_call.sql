CREATE TABLE "user_onboarding" (
	"user_id" text PRIMARY KEY NOT NULL,
	"completed_tasks" text DEFAULT '[]' NOT NULL,
	"skipped_tasks" text DEFAULT '[]' NOT NULL,
	"celebrated_tasks" text DEFAULT '[]' NOT NULL,
	"updated_at" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "workspace_onboarding" (
	"workspace_id" text NOT NULL,
	"user_id" text NOT NULL,
	"completed_tasks" text DEFAULT '[]' NOT NULL,
	"skipped_tasks" text DEFAULT '[]' NOT NULL,
	"celebrated_tasks" text DEFAULT '[]' NOT NULL,
	"updated_at" bigint NOT NULL,
	CONSTRAINT "workspace_onboarding_workspace_id_user_id_pk" PRIMARY KEY("workspace_id","user_id")
);
--> statement-breakpoint
ALTER TABLE "user_onboarding" ADD CONSTRAINT "user_onboarding_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_onboarding" ADD CONSTRAINT "workspace_onboarding_workspace_id_user_id_member_organizationId_userId_fk" FOREIGN KEY ("workspace_id","user_id") REFERENCES "public"."member"("organizationId","userId") ON DELETE cascade ON UPDATE no action;