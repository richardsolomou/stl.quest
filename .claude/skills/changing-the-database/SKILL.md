---
name: changing-the-database
description: Change the Drizzle/SQLite schema safely — generate and verify migrations, keep workspace scoping intact, pick the right timestamp type. Use before editing anything under src/db/ or drizzle/.
---

# Changing the database

1. Edit the domain-grouped schema files under `src/db/schema/` (`auth.ts`, `production.ts`, `analysis.ts`, `settings.ts`) only. Never touch existing files under `drizzle/` — user installs auto-migrate on boot, and a bad migration aborts their boot (migrations run with FKs off, then `PRAGMA foreign_key_check`; violations throw).
2. Schema conventions:
   - Explicit snake_case column names: `text('workspace_id')`.
   - Timestamps: app tables use plain `integer` epoch-ms; Better Auth tables use the custom `isoDate` type. Match the table you're editing.
   - Tenant-owned tables need a `workspace_id` column and a composite FK to the parent, e.g. `plate_model_analysis` PK `(workspaceId, requestId)` referencing `(requests.workspaceId, requests.id)`. This is the DB-level workspace isolation — no exceptions.
3. Generate and verify: `pnpm db:generate && pnpm db:check`. Commit the generated `drizzle/*.sql` and `drizzle/meta/*` files.
4. New repository methods on `DrizzleRepository` (`src/db/repository.ts`) must filter by `this.workspace()`. The `Repository` interface (`src/core/types.ts`) has no workspace parameter on purpose — scoping comes from `DrizzleRepository.scoped(workspaceId)`. Reusable selections and row mappers live under `src/db/repository/`.
5. New product configuration goes in the `settings` table (workspace-scoped, PK `workspace_id`+`key`) or `deployment_settings` (global), never a new env var.
6. A pending migration triggers an automatic pre-migration SQLite backup at boot. For risky changes, test the upgrade path: run the app against a copy of an existing `data-dev` database.
7. Tick the "Database changes use a new numbered migration" PR checklist item.
