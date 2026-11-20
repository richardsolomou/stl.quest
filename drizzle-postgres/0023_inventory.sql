CREATE TABLE "consumables" (
	"workspace_id" text NOT NULL,
	"id" text NOT NULL,
	"position" integer NOT NULL,
	"kind" text NOT NULL,
	"name" text NOT NULL,
	"preset_id" text,
	"price" double precision NOT NULL,
	"density_grams_per_ml" double precision,
	"colour_json" text,
	"print_type" text,
	"lifespan" double precision,
	"lifespan_unit" text,
	"printer_preset_id" text,
	"printer_id" text,
	"unit" text,
	"minimum_stock" double precision,
	"pack_size" double precision,
	"archived_at" bigint,
	"created_at" bigint NOT NULL,
	"updated_at" bigint NOT NULL,
	CONSTRAINT "consumables_workspace_id_id_pk" PRIMARY KEY("workspace_id","id"),
	CONSTRAINT "consumables_kind_check" CHECK ("consumables"."kind" IN ('resin', 'filament', 'part', 'supply')),
	CONSTRAINT "consumables_print_type_check" CHECK ("consumables"."print_type" IN ('resin', 'filament') OR "consumables"."print_type" IS NULL),
	CONSTRAINT "consumables_lifespan_unit_check" CHECK ("consumables"."lifespan_unit" IN ('plates', 'hours') OR "consumables"."lifespan_unit" IS NULL),
	CONSTRAINT "consumables_unit_check" CHECK ("consumables"."unit" IN ('ml', 'g', 'item') OR "consumables"."unit" IS NULL)
);
--> statement-breakpoint
CREATE TABLE "equipment" (
	"workspace_id" text NOT NULL,
	"id" text NOT NULL,
	"position" integer NOT NULL,
	"name" text NOT NULL,
	"preset_id" text,
	"kind" text NOT NULL,
	"stage" text NOT NULL,
	"print_type" text,
	"power_watts" double precision NOT NULL,
	"minutes_per_use" double precision NOT NULL,
	"supplies_json" text DEFAULT '[]' NOT NULL,
	"purchase_price" double precision,
	"lifespan_hours" double precision,
	"archived_at" bigint,
	"created_at" bigint NOT NULL,
	"updated_at" bigint NOT NULL,
	CONSTRAINT "equipment_workspace_id_id_pk" PRIMARY KEY("workspace_id","id"),
	CONSTRAINT "equipment_kind_check" CHECK ("equipment"."kind" IN ('wash', 'cure', 'wash-cure', 'oven', 'ultrasonic', 'dryer', 'other')),
	CONSTRAINT "equipment_stage_check" CHECK ("equipment"."stage" IN ('before-printing', 'finishing')),
	CONSTRAINT "equipment_print_type_check" CHECK ("equipment"."print_type" IN ('resin', 'filament') OR "equipment"."print_type" IS NULL)
);
--> statement-breakpoint
CREATE TABLE "printers" (
	"workspace_id" text NOT NULL,
	"id" text NOT NULL,
	"position" integer NOT NULL,
	"name" text NOT NULL,
	"print_type" text NOT NULL,
	"preset_id" text,
	"width_mm" double precision,
	"depth_mm" double precision,
	"height_mm" double precision,
	"purchase_price" double precision,
	"lifespan_hours" double precision,
	"power_watts" double precision,
	"add_on_preset_ids_json" text DEFAULT '[]' NOT NULL,
	"archived_at" bigint,
	"created_at" bigint NOT NULL,
	"updated_at" bigint NOT NULL,
	CONSTRAINT "printers_workspace_id_id_pk" PRIMARY KEY("workspace_id","id"),
	CONSTRAINT "printers_print_type_check" CHECK ("printers"."print_type" IN ('resin', 'filament'))
);
--> statement-breakpoint
CREATE TABLE "data_migrations" (
	"id" text PRIMARY KEY NOT NULL,
	"applied_at" bigint NOT NULL
);
--> statement-breakpoint
ALTER TABLE "consumables" ADD CONSTRAINT "consumables_workspace_id_organization_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "equipment" ADD CONSTRAINT "equipment_workspace_id_organization_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "printers" ADD CONSTRAINT "printers_workspace_id_organization_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "consumables_position" ON "consumables" USING btree ("workspace_id","position");--> statement-breakpoint
CREATE INDEX "equipment_position" ON "equipment" USING btree ("workspace_id","position");--> statement-breakpoint
CREATE INDEX "printers_position" ON "printers" USING btree ("workspace_id","position");