# PrintHub Vision

> PrintHub is a hackable, self-hosted intake and queue for 3D print requests. Run it beside your files, choose your ingress, and adapt the workflow to your workshop.

Three promises:

- **Files stay useful:** models remain ordinary files on storage the operator controls.
- **Defaults work:** pulling the image and mounting a directory produces a functional print queue.
- **The harness adapts:** storage, workflow, and integrations can change without replacing the core application.

The guiding principle: PrintHub should not tunnel into the user's storage. PrintHub should run next to the user's storage. Cloudflare, Tailscale, or a plain LAN are ingress recipes, never application dependencies.

## The appliance

PrintHub installs like a first-class NAS app (TrueNAS, Unraid, any Docker host): one image, two mounts, open the browser.

```yaml
services:
  printhub:
    image: ghcr.io/richardsolomou/printhub
    ports:
      - "3010:3000"
    volumes:
      - ./data:/data
      - /mnt/my-print-files:/prints
```

A fresh instance shows a welcome form and the first visitor claims the operator account — no environment variables, tokens, or restarts required (`DATA_DIR` is the only env var, and it has a default). Everything else is configured in the app: the settings pages cover accounts, users, board visibility, storage (local folder by default, S3-compatible object storage as the first alternative), and telemetry; workflow configuration will live there as it arrives.

What ships by default:

- SQLite metadata under `/data`, ordinary STL files arranged by status under `/prints`.
- Requester and operator roles with built-in email/password accounts; OAuth sign-in (Google, Discord, …) is the planned next step.
- A `To Do → In Progress → Done` board with per-copy movement.
- Quantity, notes, requester, and source URL fields.
- Chunked uploads to 1 GB, server-generated thumbnails and previews, SSE live updates.
- Anonymous usage telemetry, on by default with an in-app opt-out.

## Architecture

```text
React interface
      |
PrintHub core (PrintRequest, workflow, services)
  |-- Repository      (SQLite)
  |-- AssetStore      (local filesystem | S3-compatible, operator-selectable)
  |-- Auth            (better-auth: email/password; OAuth next)
  |-- EventBus        (in-process SSE fan-out)
  `-- Telemetry       (PostHog, opt-out)
```

Routes and UI code stay independent of deployment-specific infrastructure. These boundaries are deliberately internal until real extension use cases stabilize them; the current implementations are single-process by design. Chunked uploads always stage on local disk under `/data`; only finished files sit behind the storage adapter. Supporting interchangeable databases is not a goal — the boundary exists so a future need has somewhere to land, not to promise portability.

## Extensibility sequence

Do not begin with a dynamic plugin system. Introduce extensibility in this order, each step driven by a concrete need:

1. 3MF uploads and previews alongside STL.
2. Stable lifecycle events (`request.created`, `request.copiesMoved`, …) exposed to server-side extensions — notifications, webhooks, printer integrations, backups.
3. Configurable workflow statuses and request fields.
4. UI extension slots, only when a demonstrated use case requires them.

Extensions start as modules compiled into a custom image; installing packages through the admin interface is not required. The goal is source-level approachability: read the code, add a small module, maintain your variation without fighting the architecture.

## Non-goals

- A hosted SaaS control plane, plugin marketplace, or hot-installed server packages.
- Support for every database, or built-in SMB/NFS/ZFS clients when ordinary mounts solve the problem.
- Print-farm ERP: payments, invoicing, shipping, CRM.
- Automatic slicing or printer control in the core.
- A general-purpose automation engine.
