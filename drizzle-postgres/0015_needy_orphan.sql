--> Better Auth 1.7 scopes account identity by issuer. Add the column nullable, derive
--> `issuer` from `providerId` the same way Better Auth does (`local:credential` for
--> password accounts, `local:oauth:<providerId>` for social providers without an issuer
--> of their own), then enforce NOT NULL so existing rows survive the upgrade.
ALTER TABLE "account" ADD COLUMN "issuer" text;--> statement-breakpoint
UPDATE "account" SET "issuer" = CASE WHEN "providerId" = 'credential' THEN 'local:credential' ELSE 'local:oauth:' || "providerId" END WHERE "issuer" IS NULL;--> statement-breakpoint
ALTER TABLE "account" ALTER COLUMN "issuer" SET NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "account_issuer_accountId_unique" ON "account" USING btree ("issuer","accountId");
