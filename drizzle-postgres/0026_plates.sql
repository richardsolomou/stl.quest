CREATE TABLE "plate_items" (
	"workspace_id" text NOT NULL,
	"plate_id" text NOT NULL,
	"request_id" text NOT NULL,
	"copies" integer NOT NULL,
	"amount" double precision,
	"minutes" double precision,
	CONSTRAINT "plate_items_workspace_id_plate_id_request_id_pk" PRIMARY KEY("workspace_id","plate_id","request_id"),
	CONSTRAINT "plate_items_copies_check" CHECK ("plate_items"."copies" > 0)
);
--> statement-breakpoint
CREATE TABLE "plates" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"number" integer NOT NULL,
	"printer_id" text,
	"other_stuff" integer DEFAULT 0 NOT NULL,
	"transaction_id" text,
	"source" text,
	"method" text,
	"unit" text,
	"minutes" double precision,
	"other_amount" double precision,
	"overhead_amount" double precision,
	"recorded_at" bigint,
	"created_at" bigint NOT NULL,
	"updated_at" bigint NOT NULL,
	CONSTRAINT "plates_workspace_id_unique" UNIQUE("workspace_id","id"),
	CONSTRAINT "plates_workspace_number_unique" UNIQUE("workspace_id","number"),
	CONSTRAINT "plates_source_check" CHECK ("plates"."source" IN ('file', 'totals') OR "plates"."source" IS NULL),
	CONSTRAINT "plates_method_check" CHECK ("plates"."method" IN ('measured', 'volume', 'estimate', 'even') OR "plates"."method" IS NULL),
	CONSTRAINT "plates_unit_check" CHECK ("plates"."unit" IN ('g', 'ml') OR "plates"."unit" IS NULL)
);
--> statement-breakpoint
ALTER TABLE "requests" ADD COLUMN "charged_amount" double precision;--> statement-breakpoint
ALTER TABLE "requests" ADD COLUMN "charged_currency" text;--> statement-breakpoint
ALTER TABLE "usage_events" ADD COLUMN "plate_id" text;--> statement-breakpoint
ALTER TABLE "usage_events" ADD COLUMN "superseded_by" text;--> statement-breakpoint
ALTER TABLE "plate_items" ADD CONSTRAINT "plate_items_workspace_plate_fk" FOREIGN KEY ("workspace_id","plate_id") REFERENCES "public"."plates"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plate_items" ADD CONSTRAINT "plate_items_workspace_request_fk" FOREIGN KEY ("workspace_id","request_id") REFERENCES "public"."requests"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plates" ADD CONSTRAINT "plates_workspace_id_organization_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plates" ADD CONSTRAINT "plates_workspace_printer_fk" FOREIGN KEY ("workspace_id","printer_id") REFERENCES "public"."printers"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "plate_items_request" ON "plate_items" USING btree ("workspace_id","request_id");--> statement-breakpoint
CREATE INDEX "usage_events_superseded" ON "usage_events" USING btree ("workspace_id","superseded_by");