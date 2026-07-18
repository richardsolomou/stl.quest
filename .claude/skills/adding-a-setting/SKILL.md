---
name: adding-a-setting
description: Add a product setting end to end — workspace vs deployment scope, the typed settings-table access, encryption for secrets, resetApp() for wiring changes, and the settings pane. Use when adding or changing any user-facing configuration.
---

# Adding a setting

Product configuration lives in the database, never in env vars (those are reserved for paths, ops, recovery, and managed-deployment overrides).

1. Pick the scope: the `settings` table (workspace-scoped, most things — printers, board, storage) or `deployment_settings` (deployment-global — auth providers, SMTP, telemetry). No migration needed; both are key/value tables.
2. Keys are kebab-case strings (`plate-planner-profiles`, `board`); values are typed JSON via `context.repository.getSetting<T>(key)` / `setSetting(key, value)`. Deployment settings go through the `deploymentSettings` accessor in `src/server/app.ts`.
3. Server function: zod schema in `src/server/schemas.ts`, then the standard fn shape (see the `adding-server-functions` skill) — `workspaceAdmin` guard for workspace settings, `admin` for deployment settings.
4. Secrets (credentials, tokens) never go in plain: store with `encryptSetting()` under a separate `*Encrypted` key (see `storageEncrypted` in `src/server/fns.ts`), and return only a redacted/public projection to the client.
5. If the setting affects app wiring (auth providers, SMTP, storage adapters), call `resetApp()` after persisting so the composition root rebuilds; SSE clients reconnect automatically.
6. UI: one self-contained pane per settings tab in `src/client/components/settings/` (workspace tabs) with its own queries and mutations; deployment settings render under the Admin area. `UnsavedChangesGuard` exists for dirty-state warnings.
7. The PR checklist requires documenting user-facing configuration — for operator-visible defaults that's the README table, otherwise the pane itself is the documentation.
