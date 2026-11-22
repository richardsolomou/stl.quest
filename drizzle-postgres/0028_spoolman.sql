CREATE TABLE "spoolman_connections" (
	"workspace_id" text PRIMARY KEY NOT NULL,
	"token_hash" text NOT NULL,
	"created_at" bigint NOT NULL,
	"received_at" bigint,
	CONSTRAINT "spoolman_connections_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "spoolman_links" (
	"workspace_id" text NOT NULL,
	"filament_id" integer NOT NULL,
	"consumable_id" text,
	"updated_at" bigint NOT NULL,
	CONSTRAINT "spoolman_links_workspace_id_filament_id_pk" PRIMARY KEY("workspace_id","filament_id")
);
--> statement-breakpoint
CREATE TABLE "spoolman_spools" (
	"workspace_id" text NOT NULL,
	"id" integer NOT NULL,
	"filament_id" integer NOT NULL,
	"filament_name" text,
	"vendor" text,
	"material" text,
	"colour_hex" text,
	"external_id" text,
	"remaining_grams" double precision,
	"archived" integer DEFAULT 0 NOT NULL,
	"updated_at" bigint NOT NULL,
	CONSTRAINT "spoolman_spools_workspace_id_id_pk" PRIMARY KEY("workspace_id","id")
);
--> statement-breakpoint
ALTER TABLE "spoolman_connections" ADD CONSTRAINT "spoolman_connections_workspace_id_organization_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "spoolman_links" ADD CONSTRAINT "spoolman_links_workspace_id_organization_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "spoolman_links" ADD CONSTRAINT "spoolman_links_workspace_consumable_fk" FOREIGN KEY ("workspace_id","consumable_id") REFERENCES "public"."consumables"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "spoolman_spools" ADD CONSTRAINT "spoolman_spools_workspace_id_spoolman_connections_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."spoolman_connections"("workspace_id") ON DELETE cascade ON UPDATE no action;