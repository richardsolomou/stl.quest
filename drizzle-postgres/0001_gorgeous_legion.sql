CREATE TABLE "managed_storage_entitlements" (
	"workspace_id" text PRIMARY KEY NOT NULL,
	"owner_id" text NOT NULL,
	CONSTRAINT "managed_storage_entitlements_owner" UNIQUE("owner_id")
);
--> statement-breakpoint
CREATE TABLE "managed_storage_usage" (
	"workspace_id" text PRIMARY KEY NOT NULL,
	"persisted_bytes" bigint DEFAULT 0 NOT NULL,
	"asset_reserved_bytes" bigint DEFAULT 0 NOT NULL
);
--> statement-breakpoint
ALTER TABLE "upload_sessions" ADD COLUMN "finalizing_bytes" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "managed_storage_entitlements" ADD CONSTRAINT "managed_storage_entitlements_workspace_id_organization_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "managed_storage_entitlements" ADD CONSTRAINT "managed_storage_entitlements_owner_id_user_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "managed_storage_usage" ADD CONSTRAINT "managed_storage_usage_workspace_id_organization_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;