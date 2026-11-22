CREATE TABLE "spoolman_restocks" (
	"workspace_id" text NOT NULL,
	"id" text NOT NULL,
	"filament_id" integer NOT NULL,
	"filament_name" text,
	"grams" double precision,
	"status" text NOT NULL,
	"spool_id" integer,
	"error" text,
	"created_at" bigint NOT NULL,
	"updated_at" bigint NOT NULL,
	CONSTRAINT "spoolman_restocks_workspace_id_id_pk" PRIMARY KEY("workspace_id","id"),
	CONSTRAINT "spoolman_restocks_status_check" CHECK ("spoolman_restocks"."status" IN ('queued', 'created', 'failed'))
);
--> statement-breakpoint
ALTER TABLE "print_jobs" ADD COLUMN "filament_usage" text;--> statement-breakpoint
ALTER TABLE "spoolman_restocks" ADD CONSTRAINT "spoolman_restocks_workspace_id_spoolman_connections_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."spoolman_connections"("workspace_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "spoolman_restocks_status" ON "spoolman_restocks" USING btree ("workspace_id","status","created_at");