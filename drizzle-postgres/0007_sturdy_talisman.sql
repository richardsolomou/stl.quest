ALTER TABLE "requests" ADD COLUMN "model_volume_mm3" real;--> statement-breakpoint
ALTER TABLE "requests" ADD COLUMN "estimated_material_override" real;--> statement-breakpoint
ALTER TABLE "requests" ADD COLUMN "estimated_print_minutes_override" real;