ALTER TABLE `print_groups` ADD `color` text DEFAULT 'blue' NOT NULL;
--> statement-breakpoint
UPDATE `print_groups`
SET `color` = CASE (
  SELECT count(*)
  FROM `print_groups` AS `earlier`
  WHERE `earlier`.`workspace_id` = `print_groups`.`workspace_id`
    AND (`earlier`.`created_at` < `print_groups`.`created_at` OR (`earlier`.`created_at` = `print_groups`.`created_at` AND `earlier`.`id` < `print_groups`.`id`))
) % 12
  WHEN 0 THEN 'blue'
  WHEN 1 THEN 'green'
  WHEN 2 THEN 'amber'
  WHEN 3 THEN 'violet'
  WHEN 4 THEN 'rose'
  WHEN 5 THEN 'cyan'
  WHEN 6 THEN 'orange'
  WHEN 7 THEN 'lime'
  WHEN 8 THEN 'fuchsia'
  WHEN 9 THEN 'sky'
  WHEN 10 THEN 'teal'
  ELSE 'indigo'
END;
