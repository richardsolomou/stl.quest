ALTER TABLE "equipment" ADD COLUMN "purchased_on" text;--> statement-breakpoint
ALTER TABLE "printers" ADD COLUMN "purchased_on" text;--> statement-breakpoint
CREATE INDEX "usage_events_printer" ON "usage_events" USING btree ("workspace_id","printer_id");