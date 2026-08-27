PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_operations` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`kind` text NOT NULL,
	`request_id` text,
	`upload_id` text,
	`payload_json` text NOT NULL,
	`state` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "operations_kind_check" CHECK("__new_operations"."kind" IN ('move', 'delete', 'upload', 'attach', 'repeat')),
	CONSTRAINT "operations_state_check" CHECK("__new_operations"."state" IN ('prepared', 'assets_moved', 'committed'))
);
--> statement-breakpoint
INSERT INTO `__new_operations`("id", "workspace_id", "kind", "request_id", "upload_id", "payload_json", "state", "created_at", "updated_at") SELECT "id", "workspace_id", "kind", "request_id", "upload_id", "payload_json", "state", "created_at", "updated_at" FROM `operations`;--> statement-breakpoint
DROP TABLE `operations`;--> statement-breakpoint
ALTER TABLE `__new_operations` RENAME TO `operations`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `operations_state` ON `operations` (`state`,`created_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `operations_active_request` ON `operations` (`workspace_id`,`request_id`) WHERE "operations"."request_id" IS NOT NULL AND "operations"."state" <> 'committed';--> statement-breakpoint
CREATE UNIQUE INDEX `operations_upload` ON `operations` (`workspace_id`,`upload_id`) WHERE "operations"."upload_id" IS NOT NULL;