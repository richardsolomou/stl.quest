ALTER TABLE "asset_generation_jobs" DROP CONSTRAINT "asset_generation_jobs_stage_check";--> statement-breakpoint
ALTER TABLE "asset_generation_jobs" ADD CONSTRAINT "asset_generation_jobs_stage_check" CHECK ("asset_generation_jobs"."stage" IN ('geometry', 'thumbnail', 'preview'));--> statement-breakpoint
INSERT INTO "asset_generation_jobs" ("workspace_id", "request_id", "stage", "status", "queued_at")
SELECT "workspace_id", "id", 'geometry', 'pending', CAST(EXTRACT(EPOCH FROM clock_timestamp()) * 1000 AS bigint)
FROM "requests"
WHERE "model_volume_mm3" IS NULL OR "model_surface_area_mm2" IS NULL
ON CONFLICT DO NOTHING;
