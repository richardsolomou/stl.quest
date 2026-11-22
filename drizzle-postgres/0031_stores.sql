CREATE TABLE "stores" (
	"workspace_id" text NOT NULL,
	"id" text NOT NULL,
	"position" integer NOT NULL,
	"name" text NOT NULL,
	"shipping_cost" double precision,
	"free_shipping_over" double precision,
	"archived_at" bigint,
	"created_at" bigint NOT NULL,
	"updated_at" bigint NOT NULL,
	CONSTRAINT "stores_workspace_id_id_pk" PRIMARY KEY("workspace_id","id")
);
--> statement-breakpoint
ALTER TABLE "consumables" ADD COLUMN "store_id" text;--> statement-breakpoint
ALTER TABLE "stores" ADD CONSTRAINT "stores_workspace_id_organization_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "stores_position" ON "stores" USING btree ("workspace_id","position");--> statement-breakpoint
ALTER TABLE "consumables" ADD CONSTRAINT "consumables_workspace_store_fk" FOREIGN KEY ("workspace_id","store_id") REFERENCES "public"."stores"("workspace_id","id") ON DELETE no action ON UPDATE no action;