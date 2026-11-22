ALTER TABLE "consumables" ADD COLUMN "slicer" text;--> statement-breakpoint
ALTER TABLE "printers" ADD COLUMN "slicer" text;--> statement-breakpoint
ALTER TABLE "requests" ADD COLUMN "number" integer;--> statement-breakpoint
ALTER TABLE "requests" ADD CONSTRAINT "requests_workspace_number_unique" UNIQUE("workspace_id","number");