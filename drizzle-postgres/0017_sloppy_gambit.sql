CREATE TABLE "member_notification_preferences" (
	"workspace_id" text NOT NULL,
	"user_id" text NOT NULL,
	"kind" text NOT NULL,
	"enabled" integer NOT NULL,
	"updated_at" bigint NOT NULL,
	CONSTRAINT "member_notification_preferences_workspace_id_user_id_kind_pk" PRIMARY KEY("workspace_id","user_id","kind")
);
--> statement-breakpoint
ALTER TABLE "member_notification_preferences" ADD CONSTRAINT "member_notification_preferences_workspace_id_user_id_member_organizationId_userId_fk" FOREIGN KEY ("workspace_id","user_id") REFERENCES "public"."member"("organizationId","userId") ON DELETE cascade ON UPDATE no action;