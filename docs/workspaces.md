# Workspace architecture

<!-- markdownlint-disable MD013 -->

## Status

Implemented.

## Decision

Use **workspace** as the internal domain term. Product copy can later call it a workspace, farm, project, or something else without changing the persistence model.

A workspace is the isolation boundary for a PrintHub board. It owns its members, roles, requests, planner state, printers, storage, integrations, and board settings. A user account is global to the deployment and can belong to multiple workspaces.

Use Better Auth's organization plugin for organizations, memberships, invitations, active-workspace session state, and role permissions. Keep PrintHub's production data in PrintHub-owned tables keyed by the Better Auth organization ID.

## Goals

- Give every new user a private workspace automatically.
- Let users belong to multiple workspaces.
- Support owner, admin, and member workspace roles.
- Isolate all production data and configuration by workspace.
- Preserve self-hosted operation with one or many workspaces.
- Support a hosted deployment where each customer supplies their own file storage.
- Migrate existing installations without moving print files or losing data.

## Non-goals

- Billing, plans, quotas, and subscription enforcement.
- Cross-workspace boards, requests, printers, or storage.
- Sharing one request with several workspaces.
- Using separate databases per workspace.
- Teams within a workspace.

## Identity and roles

The Better Auth user remains deployment-global. Workspace authorization must come from the user's membership, not `user.role`.

Roles:

| Role     | Capabilities                                                                      |
| -------- | --------------------------------------------------------------------------------- |
| `owner`  | Full administration, ownership transfer, and workspace deletion                   |
| `admin`  | Manage the board, planner, printers, storage, integrations, members, and requests |
| `member` | Use the board and manage requests allowed by board privacy rules                  |

The Better Auth admin plugin grants deployment-global powers and must not represent workspace administration. Self-hosted deployments may retain a separate deployment administrator capability, but hosted users must never receive global user-management access because they own a workspace.

## Workspace selection

The active workspace is stored in Better Auth's `session.activeOrganizationId`. Application routes stay workspace-neutral:

```text
/
/planner
/settings/:section
/api/files/:requestId
/api/thumbs/:requestId
/api/events
/api/upload
```

Switching workspaces updates the authenticated session and invalidates workspace-scoped client state without navigating, so the current path, search parameters, and hash remain unchanged. A browser storage event refreshes other tabs using the same session.

Every server request resolves the active organization from the session, verifies membership, and scopes database access to that workspace. If the stored organization is missing or no longer accessible, PrintHub falls back to the user's personal workspace and repairs the session.

## Signup and invitations

After authentication, an idempotent provisioning operation ensures every user owns a personal workspace. It creates the workspace and owner membership in one transaction only when the user owns no personal workspace. Running it after every successful login makes signup recovery safe if the browser closes during initial provisioning.

The initial workspace name can be derived from the user's name and changed later. Slugs are globally unique within the deployment and are not security credentials.

Workspace invitations are email-specific Better Auth organization invitations. An invited user still receives their personal workspace and can then accept membership in the inviting workspace. Self-hosted installations without SMTP can display a copyable invitation URL while still binding acceptance to the invited email address.

## Data model

Better Auth owns these tables:

- `organization`
- `member`
- `invitation`
- `session.active_organization_id`

PrintHub adds `workspace_id` to every tenant-owned record:

- `requests`
- `request_statuses`
- `operations`
- `upload_sessions`
- `settings`
- `plate_model_analysis`
- `orientation_analysis_jobs`
- `asset_generation_jobs`

Child tables that can derive a workspace through a request still store `workspace_id`. This keeps background jobs, recovery queries, cleanup routines, and uniqueness constraints explicitly tenant-scoped.

Indexes and uniqueness constraints include `workspace_id` wherever the value is only unique inside a workspace. Repository methods accept a required workspace ID or operate through a workspace-scoped repository. There is no unscoped `listRequests()`, `getRequest(id)`, `getSetting(key)`, or equivalent method available to request handlers.

The current global `settings` primary key becomes `(workspace_id, key)` for workspace settings. Deployment settings remain separate because they are controlled by the operator rather than workspace admins.

## Settings ownership

Workspace-scoped settings:

- Board privacy and behavior.
- Printer profiles and planner drafts.
- File storage configuration.
- Printer and notification integrations.

Deployment-scoped settings:

- Authentication providers.
- SMTP delivery used by the deployment.
- Product telemetry opt-out.
- Authentication secret and other environment-controlled configuration.

Hosted deployments must encrypt workspace storage and integration credentials at rest. The existing encrypted integration-setting approach can be generalized instead of storing storage credentials as plain JSON.

## Storage isolation

Each workspace resolves its own `StorageConfig` and `AssetStore`.

For local storage, new workspaces receive a dedicated directory below the configured deployment storage root. For S3-compatible storage, the workspace configuration can point to its own bucket or prefix. Asset keys remain relative to the workspace's resolved store, so production stages keep their current readable layout.

The migrated workspace keeps the existing local root or S3 prefix unchanged. This avoids a large, failure-prone file move during the database migration. New workspaces never share that unnamespaced legacy root.

Upload staging also includes the workspace ID. Upload ownership checks use `(workspace_id, upload_id, user_id)`, and upload concurrency limits use both workspace and user identity where appropriate.

## Runtime architecture

The application singleton continues to own deployment-wide resources:

- Database connection.
- Better Auth instance.
- SMTP delivery.
- Deployment telemetry.
- Process lifecycle.

A workspace runtime owns or resolves:

- Workspace-scoped repository.
- Production service.
- Asset store.
- Asset generation queue.
- Workspace event channel.
- Workspace settings and integrations.

Request handlers obtain a `WorkspaceContext` containing the authenticated user, workspace, membership role, scoped repository, service, and assets. Admin checks use the membership role from this context.

Realtime events are partitioned by workspace. A workspace event stream only subscribes to events published for that workspace, and connection limits are keyed by workspace and user.

Background recovery and asset generation enumerate workspaces explicitly. No recovery, cleanup, or backfill query may run across tenant records unless it is a deployment maintenance operation designed to do so.

## Authorization invariants

- A request ID alone never authorizes access.
- Membership is checked before returning files, thumbnails, events, settings, people, requests, or planner data.
- Every tenant query contains `workspace_id` even when IDs are globally random.
- Workspace admins cannot call deployment-global Better Auth admin endpoints.
- Members returned by people pickers come only from the current workspace.
- Deleting a user account does not delete requests owned in shared workspaces without an explicit ownership policy.
- Removing a member does not silently delete their requests.
- Workspace deletion is blocked while recoverable production operations are active and performs explicit storage cleanup.

## Existing installation migration

The migration creates one workspace for the existing installation:

1. Create a workspace named `PrintHub` with a unique slug.
2. Add every existing user as a member.
3. Make the oldest existing admin the owner.
4. Map other admins to `admin` and requesters to `member`.
5. Assign all requests, jobs, operations, uploads, and workspace settings to that workspace.
6. Set active workspace IDs for existing sessions where supported, otherwise let the next request select it.
7. Keep the existing storage root or S3 prefix as that workspace's storage configuration.
8. Preserve unused legacy invitation links only for the migrated workspace until they expire, then remove the legacy invitation implementation.

The migration must run transactionally for database changes. File locations are not changed by the migration.

## Delivery phases

### Phase 1: tenancy primitives

- Enable the Better Auth organization plugin and schema.
- Add workspace, membership, and provisioning APIs.
- Add the workspace picker and switcher.
- Keep the current board on the migrated default workspace.

### Phase 2: scoped persistence

- Add and backfill `workspace_id` on tenant tables.
- Introduce `WorkspaceContext` and workspace-scoped repositories.
- Make files, thumbnails, uploads, events, requests, people, planner data, and settings require a workspace.
- Add isolation tests before allowing users to create a second workspace.

### Phase 3: workspace configuration

- Split workspace settings from deployment settings.
- Resolve storage, printers, integrations, queues, and diagnostics per workspace.
- Encrypt workspace credentials.
- Allow creating additional workspaces.

### Phase 4: invitations and hosted readiness

- Replace global invitation roles with workspace invitations.
- Add member and role management.
- Disable deployment-global administration for hosted users.
- Add quotas, storage health, and operator observability needed by the hosted service.

## Required tests

- A new user receives exactly one owner workspace even when provisioning retries.
- An invited user retains a personal workspace and joins the invited workspace.
- Switching workspaces keeps the user on the same application page and refreshes other tabs using the same session.
- A member cannot read a request, file, thumbnail, event, person, setting, or planner result from another workspace by guessing an ID.
- Workspace admins cannot manage users or settings in another workspace.
- Background jobs and recovery only mutate their recorded workspace.
- Existing installations migrate all records and keep existing files readable without moving them.
- Local and S3 workspaces with identical relative asset keys remain isolated.
- Removing a member preserves requests and records their historical owner safely.

## Product decisions still needed

- The user-facing term: workspace, farm, project, or another label.
- Whether members can create requests for other members.
- Whether request ownership survives account deletion as a retained profile or becomes an unassigned historical owner.
- Whether self-hosted deployment administrators can inspect all workspaces or only operate deployment settings.
- Whether hosted storage credentials are supplied directly or through supported provider-specific connection flows.
