---
name: changing-the-database
description: Change the Drizzle schemas safely — keep SQLite and PostgreSQL in sync, generate and verify migrations, preserve workspace scoping, and use the right timestamp type. Use before editing src/db/, drizzle/, or drizzle-postgres/.
---

# Changing the database

Read [Database changes](../../../docs/development/database-changes.md) before changing code. That guide is the source of truth for the SQLite and PostgreSQL schemas, migration generation, workspace isolation, and upgrade testing.

Workflow:

1. Update both schema implementations.
2. Generate both migration sets without editing existing migrations.
3. Update scoped repository methods and tests.
4. Run `pnpm db:generate && pnpm db:generate:postgres && pnpm db:check`.
5. Run `pnpm check`.
