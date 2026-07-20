ALTER TABLE `request_statuses` ADD `completed_at` integer;
--> statement-breakpoint
UPDATE `request_statuses`
SET `completed_at` = (
  SELECT `updated_at`
  FROM `requests`
  WHERE `requests`.`workspace_id` = `request_statuses`.`workspace_id`
    AND `requests`.`id` = `request_statuses`.`request_id`
)
WHERE `status_id` = 'done' AND `quantity` > 0;
