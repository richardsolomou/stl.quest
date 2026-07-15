ALTER TABLE "user" ADD COLUMN "twoFactorEnabled" integer NOT NULL DEFAULT 0;

CREATE TABLE "twoFactor" (
  "id" text NOT NULL PRIMARY KEY,
  "secret" text NOT NULL,
  "backupCodes" text NOT NULL,
  "userId" text NOT NULL REFERENCES "user" ("id") ON DELETE CASCADE,
  "verified" integer NOT NULL DEFAULT 1,
  "failedVerificationCount" integer NOT NULL DEFAULT 0,
  "lockedUntil" date
);

CREATE INDEX "twoFactor_secret_idx" ON "twoFactor" ("secret");
CREATE INDEX "twoFactor_userId_idx" ON "twoFactor" ("userId");
