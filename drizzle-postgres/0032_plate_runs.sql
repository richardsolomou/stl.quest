CREATE TABLE "print_jobs" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"printer_name" text NOT NULL,
	"printer_id" text,
	"file_name" text,
	"outcome" text NOT NULL,
	"minutes" double precision,
	"grams" double precision,
	"filament_details" text,
	"reason" text,
	"progress" double precision,
	"archive_id" text,
	"run_id" text,
	"plate_id" text,
	"personal" integer DEFAULT 0 NOT NULL,
	"transaction_id" text,
	"started_at" bigint,
	"ended_at" bigint,
	"received_at" bigint NOT NULL,
	CONSTRAINT "print_jobs_workspace_id_unique" UNIQUE("workspace_id","id"),
	CONSTRAINT "print_jobs_outcome_check" CHECK ("print_jobs"."outcome" IN ('printing', 'finished', 'failed', 'cancelled'))
);
--> statement-breakpoint
ALTER TABLE "plates" ADD COLUMN "status_id" text;--> statement-breakpoint
ALTER TABLE "plates" ADD COLUMN "started_at" bigint;--> statement-breakpoint
ALTER TABLE "print_jobs" ADD CONSTRAINT "print_jobs_workspace_id_organization_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "print_jobs" ADD CONSTRAINT "print_jobs_workspace_printer_fk" FOREIGN KEY ("workspace_id","printer_id") REFERENCES "public"."printers"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "print_jobs" ADD CONSTRAINT "print_jobs_workspace_plate_fk" FOREIGN KEY ("workspace_id","plate_id") REFERENCES "public"."plates"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "print_jobs_received" ON "print_jobs" USING btree ("workspace_id","received_at");--> statement-breakpoint
CREATE INDEX "print_jobs_plate" ON "print_jobs" USING btree ("workspace_id","plate_id");--> statement-breakpoint
CREATE INDEX "plates_status" ON "plates" USING btree ("workspace_id","status_id");