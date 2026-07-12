-- Thumbnails and previews are generated server-side after upload; this stamp
-- marks a request as processed so boot backfill only touches new or
-- interrupted rows.
ALTER TABLE requests ADD COLUMN assets_generated_at INTEGER;
