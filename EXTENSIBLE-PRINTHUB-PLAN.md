# Extensible PrintHub Plan

## Status

This document captures a possible future direction for PrintHub. It is not the architecture of the current application and does not commit the project to an immediate rewrite.

## Vision

PrintHub should be a small, self-hosted print-request harness with useful defaults. People install it wherever their files should live, then replace or extend the parts that do not fit their setup.

The project should be:

- Self-hosted and MIT licensed.
- Immediately useful with its default configuration.
- Easy to understand, modify, and redistribute.
- Independent of any particular ingress, identity provider, database service, NAS, or printer vendor.
- Extensible through configuration, adapters, lifecycle events, and packages.

The guiding principle is:

> PrintHub should not tunnel into the user's storage. PrintHub should run next to the user's storage.

For the current installation, that might look like:

```text
Friends
   |
Cloudflare Tunnel
   |
PrintHub on NAS
   |
/prints
```

Another user might run:

```text
Customers
   |
Caddy + OIDC
   |
PrintHub on a VPS
   |
Mounted S3-compatible storage
```

Or:

```text
Makerspace members
   |
Local network / Tailscale
   |
PrintHub on a mini PC
   |
SMB-mounted NAS folder
```

Cloudflare should be one supported deployment recipe, not a foundational dependency.

## Default Distribution

Vanilla PrintHub should be opinionated and immediately useful. The default installation should include:

- One web application.
- SQLite for metadata.
- Local filesystem storage.
- Requester and operator roles.
- Private print requests.
- STL and 3MF uploads and previews.
- Quantity, notes, requester, and source URL fields.
- A basic `Queued -> Printing -> Done` workflow.
- Ordinary files arranged in understandable directories.
- A Docker image and Docker Compose example.
- An MIT license.

A minimal installation should look roughly like:

```yaml
services:
  printhub:
    image: ghcr.io/printhub/printhub
    ports:
      - "3010:3000"
    volumes:
      - ./data:/data
      - /mnt/my-print-files:/prints
```

If files belong on an existing NAS, the operator mounts that location into the container. NFS, SMB, ZFS, and VPS block storage remain operating-system concerns rather than features PrintHub must reimplement.

## Architecture

The application should depend on a small set of explicit interfaces:

```text
React interface
      |
PrintHub core
  |-- Repository
  |-- AssetStore
  |-- AuthProvider
  |-- Workflow
  `-- EventBus
         |
      Extensions
```

These boundaries should keep routes and UI code independent from deployment-specific infrastructure.

### Authentication

Authentication should be provided through an `AuthProvider` instead of reading Cloudflare headers inside application routes.

Useful adapters include:

- Built-in local accounts or invite links.
- Cloudflare Access with signed JWT validation.
- Generic trusted-header authentication.
- OIDC.

Example configuration:

```ts
auth: cloudflareAccess({
  teamDomain: 'example.cloudflareaccess.com',
  audience: process.env.CLOUDFLARE_ACCESS_AUD,
})
```

Or:

```ts
auth: trustedHeader({
  emailHeader: 'x-authentik-email',
  nameHeader: 'x-authentik-name',
})
```

Authentication adapters must expose a common identity and role model to the core application.

### Storage

The first and most important storage implementation should be an excellent local filesystem provider:

```ts
storage: localFilesystem({
  root: '/prints',
})
```

Possible later adapters include S3-compatible object storage, WebDAV, and custom directory layouts.

The storage interface should deal in logical assets and must not accept arbitrary paths from a browser:

```ts
interface AssetStore {
  write(input: Upload): Promise<StoredAsset>
  read(asset: StoredAsset): Promise<ReadableStream>
  move(asset: StoredAsset, destination: string): Promise<StoredAsset>
  remove(asset: StoredAsset): Promise<void>
}
```

This boundary should also permit a custom filesystem layout without requiring changes to upload routes or workflow code.

### Repository

SQLite should be the default metadata store. A `Repository` boundary should keep persistence out of route and UI code, but supporting interchangeable databases is not an initial goal.

The first version should optimize for a robust single-instance SQLite deployment rather than spending effort on database portability. The boundary leaves room for a different implementation later if a real use case justifies it.

### Workflow

The current three columns should become the default workflow rather than being hard-coded throughout the application:

```ts
workflow: defineWorkflow({
  statuses: [
    { id: 'queued', label: 'Queued', folder: 'queued' },
    { id: 'printing', label: 'Printing', folder: 'printing' },
    { id: 'done', label: 'Done', folder: 'done' },
  ],
})
```

An SLA-oriented installation might choose:

```text
Queued -> Supported -> Sliced -> Printing -> Washing -> Curing -> Done
```

A small business might use:

```text
Submitted -> Quoting -> Approved -> Printing -> Ready -> Collected
```

Workflow configuration should remain deliberately small. PrintHub does not need to become a general-purpose automation engine.

### Events and Hooks

Lifecycle events should be the main extension mechanism:

```ts
printhub.on('request.created', async ({ request }) => {})
printhub.on('asset.uploaded', async ({ asset }) => {})
printhub.on('job.statusChanged', async ({ job, from, to }) => {})
printhub.on('request.completed', async ({ request }) => {})
```

Extensions can use these events to add:

- Discord, Slack, or email notifications.
- Generic webhooks.
- Home Assistant events.
- Printer integrations.
- Slicing commands.
- Automatic backups.
- Audit logging.
- Material tracking.

The core should emit stable, well-defined events rather than acquiring direct knowledge of every external system.

## Configuration and Custom Distributions

Configuration should be expressible as code for advanced installations:

```ts
import { defineConfig } from '@printhub/core'
import { cloudflareAccess } from '@printhub/auth-cloudflare'
import { localFilesystem } from '@printhub/storage-local'
import { discordNotifications } from '@printhub/discord'

export default defineConfig({
  auth: cloudflareAccess(),
  storage: localFilesystem({ root: '/prints' }),

  workflow: {
    statuses: ['queued', 'printing', 'done'],
  },

  extensions: [
    discordNotifications({
      webhook: process.env.DISCORD_WEBHOOK!,
    }),
  ],
})
```

An operator should be able to maintain a custom distribution containing only configuration and dependencies:

```text
my-printhub/
  printhub.config.ts
  package.json
  Dockerfile
```

Extensions may be installed from npm or Git and compiled into that custom image. The stock Docker image should continue to support straightforward environment-variable configuration for users who do not want to build anything.

## Extensibility Sequence

Do not begin with a large dynamic plugin system. Dynamically loading third-party React interfaces, database migrations, and arbitrary server code creates substantial security and compatibility obligations.

Introduce extensibility in this order:

1. Configuration.
2. Authentication and storage interfaces.
3. Lifecycle events and server-side extensions.
4. Custom request fields and workflow statuses.
5. UI extension slots when a demonstrated use case requires them.

Initially, extensions can be compiled into a custom image. Installing packages dynamically through the administration interface is not required.

The goal is source-level approachability: someone should be able to read the code, add a small module, and maintain their variation without fighting the architecture.

## Migration from the Current Application

Most of the existing interface and browser-side STL pipeline can remain. The migration should proceed through explicit boundaries rather than a full rewrite.

### Phase 1: Establish Boundaries

1. Define the core identity, asset, repository, workflow, and event types.
2. Put the current behavior behind those interfaces without changing the user experience.
3. Remove direct Cloudflare identity reads from application routes.
4. Remove direct filesystem operations from request and workflow handlers.
5. Centralize status and folder definitions.

### Phase 2: Standalone Defaults

1. Add SQLite as the default repository.
2. Add the local filesystem `AssetStore`.
3. Replace direct browser-to-Convex data access with server-owned queries and realtime updates.
4. Add a simple built-in authentication option.
5. Store all persistent application state beneath mounted `/data` and `/prints` roots.
6. Add backup, restore, upgrade, and recovery documentation.

### Phase 3: Preserve the Current Deployment as an Adapter

1. Implement Cloudflare Access as a supported authentication adapter.
2. Document Cloudflare Tunnel as an ingress recipe.
3. Move the current TrueNAS Custom App deployment into an `examples/cloudflare-nas` reference.
4. Decide whether the existing Convex implementation remains a maintained adapter or becomes a migration-only path.

### Phase 4: Extension API

1. Add stable lifecycle events.
2. Document extension authoring and compatibility expectations.
3. Create one small first-party notification extension as a reference.
4. Add configurable workflow statuses and request fields.
5. Add UI extension points only in response to concrete extension requirements.

## Explicit Non-Goals

The initial extensible version should not attempt to provide:

- A hosted SaaS control plane.
- Automatic router or tunnel provisioning.
- A plugin marketplace.
- Hot installation of arbitrary server packages.
- Support for every database.
- Built-in SMB, NFS, or ZFS clients when ordinary mounts solve the problem.
- Full print-farm ERP functionality.
- Payments, invoicing, shipping, or CRM.
- Automatic slicing or printer control in the core.
- A general-purpose automation engine.

Those capabilities can be supplied by extensions or considered later if actual users demonstrate a need.

## Project Positioning

> PrintHub is a hackable, self-hosted intake and queue for 3D print requests. Run it beside your files, choose your authentication and ingress, and adapt the workflow to your workshop.

The project should make three promises:

- **Files stay useful:** models remain ordinary files on storage the operator controls.
- **Defaults work:** cloning the project and mounting a directory produces a functional print queue.
- **The harness adapts:** authentication, storage, workflow, and integrations can change without replacing the core application.

## First Milestone

The first milestone should be a completely local installation using SQLite, local filesystem storage, and simple authentication while preserving Cloudflare Access as an adapter.

Success means an operator can:

1. Clone or pull PrintHub.
2. Mount a data directory and a prints directory.
3. Choose how users reach and authenticate to it.
4. Start accepting requests without provisioning an external database service.
5. Add a small integration without modifying unrelated application code.

Once that works, PrintHub will have established its central promise: install it beside the files, choose the pieces that fit, and adapt it to the workshop.
