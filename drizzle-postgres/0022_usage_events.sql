CREATE TABLE "usage_events" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"transaction_id" text NOT NULL,
	"stage" text NOT NULL,
	"kind" text NOT NULL,
	"request_id" text,
	"printer_id" text,
	"equipment_id" text,
	"consumable_id" text,
	"amount" double precision NOT NULL,
	"unit" text NOT NULL,
	"copies" integer,
	"outcome" text,
	"unit_price" double precision,
	"currency" text,
	"user_id" text,
	"created_at" bigint NOT NULL,
	"undone_at" bigint,
	CONSTRAINT "usage_events_stage_check" CHECK ("usage_events"."stage" IN ('printing', 'finishing', 'stock')),
	CONSTRAINT "usage_events_kind_check" CHECK ("usage_events"."kind" IN ('use', 'restock', 'correction', 'waste', 'replace')),
	CONSTRAINT "usage_events_unit_check" CHECK ("usage_events"."unit" IN ('ml', 'g', 'item', 'minute', 'plate')),
	CONSTRAINT "usage_events_outcome_check" CHECK ("usage_events"."outcome" IN ('completed', 'failed') OR "usage_events"."outcome" IS NULL),
	CONSTRAINT "usage_events_copies_check" CHECK ("usage_events"."copies" > 0 OR "usage_events"."copies" IS NULL)
);
--> statement-breakpoint
ALTER TABLE "usage_events" ADD CONSTRAINT "usage_events_workspace_id_organization_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "usage_events_request" ON "usage_events" USING btree ("workspace_id","request_id");--> statement-breakpoint
CREATE INDEX "usage_events_consumable" ON "usage_events" USING btree ("workspace_id","consumable_id");--> statement-breakpoint
CREATE INDEX "usage_events_transaction" ON "usage_events" USING btree ("workspace_id","transaction_id");--> statement-breakpoint
CREATE INDEX "usage_events_created" ON "usage_events" USING btree ("workspace_id","created_at");