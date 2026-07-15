ALTER TABLE plate_model_analysis ADD COLUMN estimated_volume_mm3 REAL;

UPDATE plate_model_analysis
SET estimated_volume_mm3 = json_extract(orientation_candidates, '$[0].estimatedVolumeMm3')
WHERE orientation_candidates IS NOT NULL
  AND json_valid(orientation_candidates);
