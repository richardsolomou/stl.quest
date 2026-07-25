CREATE TABLE "asset_generation_jobs" (
	"workspace_id" text NOT NULL,
	"request_id" text NOT NULL,
	"stage" text NOT NULL,
	"status" text NOT NULL,
	"error" text,
	"queued_at" bigint NOT NULL,
	"started_at" bigint,
	"finished_at" bigint,
	CONSTRAINT "asset_generation_jobs_workspace_id_request_id_stage_pk" PRIMARY KEY("workspace_id","request_id","stage"),
	CONSTRAINT "asset_generation_jobs_stage_check" CHECK ("asset_generation_jobs"."stage" IN ('thumbnail', 'preview')),
	CONSTRAINT "asset_generation_jobs_status_check" CHECK ("asset_generation_jobs"."status" IN ('pending', 'running', 'ready', 'skipped', 'failed'))
);
--> statement-breakpoint
CREATE TABLE "account" (
	"id" text PRIMARY KEY NOT NULL,
	"accountId" text NOT NULL,
	"providerId" text NOT NULL,
	"userId" text NOT NULL,
	"accessToken" text,
	"refreshToken" text,
	"idToken" text,
	"accessTokenExpiresAt" text,
	"refreshTokenExpiresAt" text,
	"scope" text,
	"password" text,
	"createdAt" text NOT NULL,
	"updatedAt" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "invitation" (
	"id" text PRIMARY KEY NOT NULL,
	"organizationId" text NOT NULL,
	"email" text NOT NULL,
	"role" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"expiresAt" text NOT NULL,
	"createdAt" text NOT NULL,
	"inviterId" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "member" (
	"id" text PRIMARY KEY NOT NULL,
	"organizationId" text NOT NULL,
	"userId" text NOT NULL,
	"role" text DEFAULT 'member' NOT NULL,
	"createdAt" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "organization" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"logo" text,
	"createdAt" text NOT NULL,
	"metadata" text,
	"personal_owner_id" text,
	CONSTRAINT "organization_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "rateLimit" (
	"id" text PRIMARY KEY NOT NULL,
	"key" text NOT NULL,
	"count" integer NOT NULL,
	"lastRequest" bigint NOT NULL,
	CONSTRAINT "rateLimit_key_unique" UNIQUE("key")
);
--> statement-breakpoint
CREATE TABLE "session" (
	"id" text PRIMARY KEY NOT NULL,
	"expiresAt" text NOT NULL,
	"token" text NOT NULL,
	"createdAt" text NOT NULL,
	"updatedAt" text NOT NULL,
	"ipAddress" text,
	"userAgent" text,
	"userId" text NOT NULL,
	"impersonatedBy" text,
	"activeOrganizationId" text,
	CONSTRAINT "session_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "twoFactor" (
	"id" text PRIMARY KEY NOT NULL,
	"secret" text NOT NULL,
	"backupCodes" text NOT NULL,
	"userId" text NOT NULL,
	"verified" integer DEFAULT 1 NOT NULL,
	"failedVerificationCount" integer DEFAULT 0 NOT NULL,
	"lockedUntil" text
);
--> statement-breakpoint
CREATE TABLE "user" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"emailVerified" integer NOT NULL,
	"image" text,
	"createdAt" text NOT NULL,
	"updatedAt" text NOT NULL,
	"role" text,
	"banned" integer,
	"banReason" text,
	"banExpires" text,
	"color" text,
	"twoFactorEnabled" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "user_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "verification" (
	"id" text PRIMARY KEY NOT NULL,
	"identifier" text NOT NULL,
	"value" text NOT NULL,
	"expiresAt" text NOT NULL,
	"createdAt" text NOT NULL,
	"updatedAt" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "operations" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"kind" text NOT NULL,
	"request_id" text,
	"upload_id" text,
	"payload_json" text NOT NULL,
	"state" text NOT NULL,
	"created_at" bigint NOT NULL,
	"updated_at" bigint NOT NULL,
	CONSTRAINT "operations_kind_check" CHECK ("operations"."kind" IN ('move', 'delete', 'upload')),
	CONSTRAINT "operations_state_check" CHECK ("operations"."state" IN ('prepared', 'assets_moved', 'committed'))
);
--> statement-breakpoint
CREATE TABLE "print_group_items" (
	"workspace_id" text NOT NULL,
	"group_id" text NOT NULL,
	"request_id" text NOT NULL,
	"quantity" integer NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "print_group_items_workspace_id_group_id_request_id_pk" PRIMARY KEY("workspace_id","group_id","request_id"),
	CONSTRAINT "print_group_items_quantity_check" CHECK ("print_group_items"."quantity" > 0)
);
--> statement-breakpoint
CREATE TABLE "print_groups" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"name" text NOT NULL,
	"color" text DEFAULT 'blue' NOT NULL,
	"status_id" text NOT NULL,
	"created_at" bigint NOT NULL,
	"updated_at" bigint NOT NULL,
	CONSTRAINT "print_groups_workspace_id_unique" UNIQUE("workspace_id","id")
);
--> statement-breakpoint
CREATE TABLE "request_statuses" (
	"workspace_id" text NOT NULL,
	"request_id" text NOT NULL,
	"status_id" text NOT NULL,
	"quantity" integer NOT NULL,
	"sort_order" real,
	"completed_at" bigint,
	CONSTRAINT "request_statuses_workspace_id_request_id_status_id_pk" PRIMARY KEY("workspace_id","request_id","status_id")
);
--> statement-breakpoint
CREATE TABLE "requests" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"name" text NOT NULL,
	"file_name" text NOT NULL,
	"file_path" text NOT NULL,
	"quantity" integer NOT NULL,
	"owner_user_id" text NOT NULL,
	"notes" text,
	"source_url" text,
	"thumbnail_path" text,
	"preview_path" text,
	"created_at" bigint NOT NULL,
	"updated_at" bigint NOT NULL,
	"assets_generated_at" bigint,
	"printer_id" text,
	"print_type" text,
	"automatic_printer_assignment" integer DEFAULT 0 NOT NULL,
	"model_width_mm" real,
	"model_depth_mm" real,
	"model_height_mm" real,
	CONSTRAINT "requests_workspace_id_unique" UNIQUE("workspace_id","id"),
	CONSTRAINT "requests_print_type_check" CHECK ("requests"."print_type" IN ('resin', 'filament') OR "requests"."print_type" IS NULL)
);
--> statement-breakpoint
CREATE TABLE "upload_sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"owner_id" text NOT NULL,
	"bytes" bigint DEFAULT 0 NOT NULL,
	"expires_at" bigint NOT NULL,
	"completed_request_id" text
);
--> statement-breakpoint
CREATE TABLE "asset_migrations" (
	"workspace_id" text NOT NULL,
	"id" text NOT NULL,
	"applied_at" bigint NOT NULL,
	CONSTRAINT "asset_migrations_workspace_id_id_pk" PRIMARY KEY("workspace_id","id")
);
--> statement-breakpoint
CREATE TABLE "deployment_settings" (
	"key" text PRIMARY KEY NOT NULL,
	"value_json" text NOT NULL,
	"updated_at" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "invites" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"token_hash" text NOT NULL,
	"role" text NOT NULL,
	"label" text,
	"recipient_email" text,
	"created_at" bigint NOT NULL,
	"expires_at" bigint NOT NULL,
	"used_at" bigint,
	"used_by" text,
	CONSTRAINT "invites_token_hash_unique" UNIQUE("token_hash"),
	CONSTRAINT "invites_role_check" CHECK ("invites"."role" IN ('admin', 'requester'))
);
--> statement-breakpoint
CREATE TABLE "settings" (
	"workspace_id" text NOT NULL,
	"key" text NOT NULL,
	"value_json" text NOT NULL,
	"updated_at" bigint NOT NULL,
	CONSTRAINT "settings_workspace_id_key_pk" PRIMARY KEY("workspace_id","key")
);
--> statement-breakpoint
ALTER TABLE "asset_generation_jobs" ADD CONSTRAINT "asset_generation_jobs_workspace_id_organization_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_generation_jobs" ADD CONSTRAINT "asset_generation_jobs_workspace_request_fk" FOREIGN KEY ("workspace_id","request_id") REFERENCES "public"."requests"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "account" ADD CONSTRAINT "account_userId_user_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitation" ADD CONSTRAINT "invitation_organizationId_organization_id_fk" FOREIGN KEY ("organizationId") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitation" ADD CONSTRAINT "invitation_inviterId_user_id_fk" FOREIGN KEY ("inviterId") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "member" ADD CONSTRAINT "member_organizationId_organization_id_fk" FOREIGN KEY ("organizationId") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "member" ADD CONSTRAINT "member_userId_user_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization" ADD CONSTRAINT "organization_personal_owner_id_user_id_fk" FOREIGN KEY ("personal_owner_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session" ADD CONSTRAINT "session_userId_user_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "twoFactor" ADD CONSTRAINT "twoFactor_userId_user_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "operations" ADD CONSTRAINT "operations_workspace_id_organization_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "print_group_items" ADD CONSTRAINT "print_group_items_workspace_group_fk" FOREIGN KEY ("workspace_id","group_id") REFERENCES "public"."print_groups"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "print_group_items" ADD CONSTRAINT "print_group_items_workspace_request_fk" FOREIGN KEY ("workspace_id","request_id") REFERENCES "public"."requests"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "print_groups" ADD CONSTRAINT "print_groups_workspace_id_organization_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "request_statuses" ADD CONSTRAINT "request_statuses_workspace_id_organization_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "request_statuses" ADD CONSTRAINT "request_statuses_workspace_request_fk" FOREIGN KEY ("workspace_id","request_id") REFERENCES "public"."requests"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "requests" ADD CONSTRAINT "requests_workspace_id_organization_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "requests" ADD CONSTRAINT "requests_owner_user_id_user_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "upload_sessions" ADD CONSTRAINT "upload_sessions_workspace_id_organization_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "upload_sessions" ADD CONSTRAINT "upload_sessions_owner_id_user_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "upload_sessions" ADD CONSTRAINT "upload_sessions_workspace_request_fk" FOREIGN KEY ("workspace_id","completed_request_id") REFERENCES "public"."requests"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_migrations" ADD CONSTRAINT "asset_migrations_workspace_id_organization_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invites" ADD CONSTRAINT "invites_workspace_id_organization_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "settings" ADD CONSTRAINT "settings_workspace_id_organization_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "asset_generation_jobs_workspace_status" ON "asset_generation_jobs" USING btree ("workspace_id","status","queued_at");--> statement-breakpoint
CREATE INDEX "account_userId_idx" ON "account" USING btree ("userId");--> statement-breakpoint
CREATE INDEX "invitation_organization_idx" ON "invitation" USING btree ("organizationId");--> statement-breakpoint
CREATE INDEX "invitation_email_idx" ON "invitation" USING btree ("email");--> statement-breakpoint
CREATE UNIQUE INDEX "member_organization_user_unique" ON "member" USING btree ("organizationId","userId");--> statement-breakpoint
CREATE INDEX "member_organization_idx" ON "member" USING btree ("organizationId");--> statement-breakpoint
CREATE INDEX "member_user_idx" ON "member" USING btree ("userId");--> statement-breakpoint
CREATE UNIQUE INDEX "organization_personal_owner_unique" ON "organization" USING btree ("personal_owner_id");--> statement-breakpoint
CREATE INDEX "rateLimit_key_idx" ON "rateLimit" USING btree ("key");--> statement-breakpoint
CREATE INDEX "session_userId_idx" ON "session" USING btree ("userId");--> statement-breakpoint
CREATE INDEX "twoFactor_secret_idx" ON "twoFactor" USING btree ("secret");--> statement-breakpoint
CREATE INDEX "twoFactor_userId_idx" ON "twoFactor" USING btree ("userId");--> statement-breakpoint
CREATE INDEX "verification_identifier_idx" ON "verification" USING btree ("identifier");--> statement-breakpoint
CREATE INDEX "operations_state" ON "operations" USING btree ("state","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "operations_active_request" ON "operations" USING btree ("workspace_id","request_id") WHERE "operations"."request_id" IS NOT NULL AND "operations"."state" <> 'committed';--> statement-breakpoint
CREATE UNIQUE INDEX "operations_upload" ON "operations" USING btree ("workspace_id","upload_id") WHERE "operations"."upload_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "print_groups_status" ON "print_groups" USING btree ("workspace_id","status_id");--> statement-breakpoint
CREATE INDEX "requests_created" ON "requests" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "requests_workspace_created" ON "requests" USING btree ("workspace_id","created_at");--> statement-breakpoint
CREATE INDEX "requests_print_type" ON "requests" USING btree ("print_type");--> statement-breakpoint
CREATE INDEX "requests_printer_id" ON "requests" USING btree ("printer_id");--> statement-breakpoint
CREATE INDEX "requests_owner_user_id" ON "requests" USING btree ("owner_user_id");--> statement-breakpoint
CREATE INDEX "upload_sessions_owner" ON "upload_sessions" USING btree ("workspace_id","owner_id","expires_at");