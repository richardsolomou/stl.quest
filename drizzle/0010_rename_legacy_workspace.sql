UPDATE `organization`
SET `name` = 'STL Quest'
WHERE `id` = 'legacy-workspace' AND `name` = 'PrintHub';--> statement-breakpoint

UPDATE `requests`
SET `thumbnail_path` = replace(`thumbnail_path`, '.printhub/', '.stlquest/')
WHERE `thumbnail_path` LIKE '.printhub/%';--> statement-breakpoint

UPDATE `requests`
SET `preview_path` = replace(`preview_path`, '.printhub/', '.stlquest/')
WHERE `preview_path` LIKE '.printhub/%';--> statement-breakpoint

UPDATE `operations`
SET `payload_json` = replace(`payload_json`, '.printhub/', '.stlquest/')
WHERE instr(`payload_json`, '.printhub/') > 0;
