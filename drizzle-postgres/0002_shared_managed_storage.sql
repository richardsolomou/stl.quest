CREATE TABLE "managed_storage_accounts" (
	"owner_id" text PRIMARY KEY NOT NULL,
	"persisted_bytes" bigint DEFAULT 0 NOT NULL,
	"asset_reserved_bytes" bigint DEFAULT 0 NOT NULL
);
--> statement-breakpoint
INSERT INTO "managed_storage_accounts" ("owner_id", "persisted_bytes", "asset_reserved_bytes")
SELECT "managed_storage_entitlements"."owner_id", coalesce(sum("managed_storage_usage"."persisted_bytes"), 0), coalesce(sum("managed_storage_usage"."asset_reserved_bytes"), 0)
FROM "managed_storage_entitlements"
LEFT JOIN "managed_storage_usage" ON "managed_storage_usage"."workspace_id" = "managed_storage_entitlements"."workspace_id"
GROUP BY "managed_storage_entitlements"."owner_id";--> statement-breakpoint
ALTER TABLE "managed_storage_entitlements" DROP CONSTRAINT "managed_storage_entitlements_owner";--> statement-breakpoint
ALTER TABLE "managed_storage_entitlements" DROP CONSTRAINT "managed_storage_entitlements_owner_id_user_id_fk";
--> statement-breakpoint
ALTER TABLE "managed_storage_accounts" ADD CONSTRAINT "managed_storage_accounts_owner_id_user_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "managed_storage_entitlements" ADD CONSTRAINT "managed_storage_entitlements_owner_id_managed_storage_accounts_owner_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."managed_storage_accounts"("owner_id") ON DELETE cascade ON UPDATE no action;
