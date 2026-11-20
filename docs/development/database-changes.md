# Database changes

STL Quest supports SQLite and PostgreSQL. Every schema change must update and verify both versions.

## Change the schemas

Make the same logical change in the feature-matched files under:

- `src/db/schema/` for SQLite
- `src/db/schema-postgres/` for PostgreSQL

The feature files are `auth.ts`, `production.ts`, `inventory.ts`, `analysis.ts`, and `settings.ts`.

Never edit an existing migration under `drizzle/` or `drizzle-postgres/`. Installations apply migrations automatically at startup, so changing a migration that may already have run can prevent the app from starting.

## Schema conventions

- Use explicit snake_case column names, such as `text('workspace_id')`.
- SQLite application tables store timestamps as integer epoch milliseconds. SQLite Better Auth tables use the custom `isoDate` type. Follow the matching PostgreSQL table's existing timestamp convention.
- Every workspace-owned table needs a `workspace_id` column and a composite foreign key to its parent. For example, the `plate_model_analysis` primary key `(workspaceId, requestId)` references `(requests.workspaceId, requests.id)`. This keeps workspace data separate at the database level.
- Product configuration belongs in `settings` for one workspace or `deployment_settings` for the whole installation. Do not add a schema column or environment variable for a key/value product setting.

## Generate and verify migrations

```sh
pnpm db:generate
pnpm db:generate:postgres
pnpm db:check
```

Commit the generated files under both `drizzle/` and `drizzle-postgres/`.

SQLite migrations run with foreign keys disabled, then `PRAGMA foreign_key_check` verifies the result. Before applying pending SQLite migrations at startup, STL Quest creates a backup automatically. For risky changes, test an upgrade against a copy of an existing `data-dev` database, never the original.

## Repository methods

Every repository method that reads or writes workspace-owned data must filter through `this.workspace()`. The `Repository` interface in `src/core/types.ts` intentionally has no workspace parameter. Workspace callers receive a repository already limited by `DrizzleRepository.scoped(workspaceId)`; bootstrap and deployment-wide methods remain global.

Put reusable selections and database-row converters under `src/db/repository/`.

## Asset migrations

Changes to stored model paths or provider folders use the append-only registry in `src/server/assetMigrations/`. Add a numbered migration and append it to the registry. Never edit, reorder, rename, or remove a released asset migration.

Each workspace records a migration as complete only after its filesystem operation and database checkpoint both succeed. This allows upgrades to run every missing migration in order, including when an installation skips releases.

## Data migrations

One-way changes to stored data, such as reshaping settings JSON or copying it into a new table, use the append-only registry in `src/db/dataMigrations/`. Add a numbered migration and append it to the registry. Never edit, reorder, rename, or remove a released data migration.

A data migration names the schema migration it runs after in `after`: the tag without its number, which must be the same in both dialects, so generate both with the same `--name`. At startup, inside the `database-migrations` work lease and before anything reads the data, the schema is migrated up to each pending data migration's `after`, the data migration runs in one transaction with the row in `data_migrations` that records it, and the remaining schema migrations follow. The deployment records each migration once, since it rewrites every workspace at once; a failure rolls that migration back, stops the rest, and retries on the next start.

Because later schema migrations have not run yet when it runs, a data migration declares the tables and columns it touches itself, rather than importing `src/db/schema` or the repository, which keep changing after it is released.

This is how a new foreign key can point at rows that only exist once data is copied: the schema migration that creates the table comes first, the data migration fills it and clears references to rows that no longer exist (logging each), and a later schema migration adds the foreign keys. `0036_inventory`, `0002_inventory_tables`, and `0037_inventory_references` work this way.
