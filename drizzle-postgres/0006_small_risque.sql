ALTER TABLE "print_group_items" ADD COLUMN "status_id" text;--> statement-breakpoint
UPDATE "print_group_items" AS items SET "status_id" = groups."status_id" FROM "print_groups" AS groups WHERE groups."workspace_id" = items."workspace_id" AND groups."id" = items."group_id";--> statement-breakpoint
ALTER TABLE "print_group_items" ALTER COLUMN "status_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "print_group_items" DROP CONSTRAINT "print_group_items_workspace_id_group_id_request_id_pk";--> statement-breakpoint
ALTER TABLE "print_group_items" ADD CONSTRAINT "print_group_items_workspace_id_group_id_request_id_status_id_pk" PRIMARY KEY("workspace_id","group_id","request_id","status_id");--> statement-breakpoint
ALTER TABLE "print_groups" ADD COLUMN "parent_id" text;--> statement-breakpoint
ALTER TABLE "print_groups" ADD CONSTRAINT "print_groups_workspace_parent_fk" FOREIGN KEY ("workspace_id","parent_id") REFERENCES "public"."print_groups"("workspace_id","id") ON DELETE cascade ON UPDATE no action;
