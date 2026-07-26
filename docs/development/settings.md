# Adding a setting

Store product settings in the database, not in environment variables. Environment variables are reserved for file paths, deployment operations, recovery, and read-only settings controlled by the hosting environment.

## Choose the scope

Use `settings` for configuration that belongs to one workspace, including printers, board options, and storage. Use `deployment_settings` for the whole installation, including sign-in providers, email delivery, and telemetry. Both are key/value tables, so adding a key does not require a migration.

Use kebab-case string keys such as `printers` and `board`. Values are typed JSON, read and written with `context.repository.getSetting<T>(key)` and `setSetting(key, value)`. Access deployment settings through `deploymentSettings` in `src/server/app.ts`.

## Server behavior

Add a Zod schema in `src/server/schemas.ts`, then follow the [server-function rules](server-functions.md). Require `workspaceAdmin` for workspace settings and `superAdmin` for deployment settings.

Never store credentials or tokens as plain text. Encrypt them with `encryptSetting()` under a separate `*Encrypted` key; `storageEncrypted` in `src/server/fns.ts` is the example. Return only safe, redacted fields to the client.

If the setting changes a service created during application startup, such as a sign-in provider, SMTP, or storage adapter, call `resetApp()` after saving it. This rebuilds those services and reconnects event-stream clients.

## User interface and documentation

Give each workspace settings tab one self-contained pane in `src/client/components/settings/`, with its own queries and mutations. Show deployment settings in the Admin area. Use `UnsavedChangesGuard` to warn about unsaved edits.

Document user-facing configuration. Put defaults that operators need to know in the README or [deployment guide](../deployment.md); otherwise, make the settings pane clear enough to explain itself.
