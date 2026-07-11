# PrintHub

PrintHub is a self-hosted STL request board for a small group. It runs as one Node application with SQLite metadata and ordinary files on storage you control.

## Features

- Chunked STL uploads up to 1 GB, browser-generated thumbnails, and optimized viewer previews.
- Full-detail downloads while previews keep initial browser downloads small.
- Copy-level movement through a runtime-defined To Do → In Progress → Done workflow.
- Built-in first-run operator setup, password login and self-service password changes, with secure HttpOnly sessions.
- Optional trusted-header identity for Cloudflare Access and other authenticated proxies.
- Live board refresh across browsers through Server-Sent Events.
- Quantity, notes, requester, and source URL fields on every request.
- Optional PostHog telemetry; no external telemetry is enabled by default.

PrintHub is MIT licensed. Where the project is headed lives in [VISION.md](VISION.md).

## Architecture and storage

TanStack Start owns all reads and mutations. The application core depends on internal `Repository`, `AssetStore`, auth, workflow, event, and telemetry boundaries. SQLite runs in WAL mode with foreign keys, a busy timeout, and numbered migrations.

Persistent paths:

- `/data/printhub.sqlite`: metadata, users, sessions, and settings.
- `/data/uploads`: bounded incomplete chunked uploads, swept after 24 hours (always local, regardless of storage adapter).
- `/prints/todo`, `/prints/in-progress`, `/prints/done`: original STL files (default local storage).
- `/prints/.printhub/previews` and `/prints/.printhub/thumbnails`: derived viewer and card images.

Finished print files live behind a storage adapter the operator picks in **Settings → Storage**: a local folder (default `/prints`) or S3-compatible object storage (MinIO, R2, B2, Wasabi…). Switching adapters requires an empty board and does not migrate existing files. S3 credentials are stored in `/data/printhub.sqlite`, so protect that mount.

The STL lives with its least-finished copies. Status moves and deletes use a durable SQLite operation journal: filesystem work is idempotent, metadata and the committed journal state change in one transaction, and unfinished operations replay before the app accepts traffic. Managed trash is retried and swept after committed deletes. PrintHub currently supports one application process; its SQLite connection, upload registry and SSE event bus are process-local.

Coming from the Convex-backed PrintHub? [MIGRATION.md](MIGRATION.md) walks through exporting Convex, importing requests, users, thumbnails, and previews with `pnpm migrate:convex`, and reconnecting Cloudflare Access — your files never move off the NAS.

## Local development

Requirements: Node 22+ and pnpm 10.33+.

```sh
pnpm install
DATA_DIR=./data-dev pnpm dev
```

Open `http://localhost:3000`. A fresh database shows a welcome form; whoever submits it first becomes the operator. Passwords must be at least 8 characters and are hashed with Argon2id.

Storage defaults to `/prints`, which usually is not writable on a dev machine — the app still boots (health stays red) so you can point **Settings → Storage** at an absolute path like `$PWD/prints-dev`.

Checks:

```sh
pnpm typecheck
pnpm test
pnpm build
```

## Docker

The default image needs two persistent mounts and no cloud service:

```yaml
services:
  app:
    image: ghcr.io/richardsolomou/printhub:latest
    ports: ["3010:3000"]
    volumes:
      - ./data:/data
      - /mnt/my-print-files:/prints
```

For Docker Compose, copy `.env.example` to `.env`, set the two host paths, and run `docker compose up -d`. On a fresh installation the first person to open the app claims the operator account, so create it before exposing the app beyond your network.

`DATA_DIR` (default `/data`) is the only environment variable the app reads. Everything else — storage backend, authentication mode, telemetry — lives in **Settings** and persists in `/data/printhub.sqlite`.

The unauthenticated `/api/health` endpoint returns success only after migrations and recovery finish, SQLite responds, and both storage and the upload staging area accept a write probe. It can be used for container readiness and health checks.

How users reach the app is an ingress choice, not an application dependency. [`examples/cloudflare-nas`](examples/cloudflare-nas/README.md) is the reference recipe: PrintHub on a NAS (Compose or TrueNAS Custom App) behind a Cloudflare Tunnel, with either built-in login or Cloudflare Access identity.

To delegate identity to Cloudflare Access or another trusted proxy, open **Settings → Authentication**, pick trusted-header mode, and set the email header, a proxy secret of at least 24 characters, and the operator emails. The proxy must overwrite `X-PrintHub-Proxy-Secret` with that secret on every request; PrintHub fails closed without it. As a lockout safeguard, the switch only saves when the request making it already arrived through the proxy. Recovery, if you ever do lock the instance: `sqlite3 /data/printhub.sqlite "DELETE FROM settings WHERE key='auth'"` and restart.

## Releases, upgrades, and rollback

A push to `main` publishes `latest`, `v<package version>`, and immutable `sha-<commit>` images for amd64 and arm64. TrueNAS can monitor `latest` for updates. Database migrations run automatically on startup; back up before applying a new image.

Rollback by selecting a previous `vX.Y.Z` or `sha-...` image. If a release applied a non-backward-compatible migration, restore the matching database backup as well.

The first standalone release is not an in-place upgrade from the old Convex-backed build. There is deliberately no migration tooling because the project had no production data at this transition. Use a fresh `/data` mount and re-upload any requests you want PrintHub to manage.

## Backup and restore

Back up `/data` and `/prints` together. For a consistent manual backup, stop the app first, copy both directories, then start it again. Restore by stopping the app, replacing both mounted directories from the same backup set, and starting the matching or newer image.

SQLite WAL files next to `printhub.sqlite` are part of a live database. Do not copy only the main file while the app is running. An online backup command is not included yet.

## Upload limits

PrintHub accepts sequential multipart chunks up to 64 MB and an assembled STL up to 1 GB. It requires a valid `Content-Length` and rejects oversized declared request bodies before multipart parsing, limits concurrent multipart parsing, persists ownership and quotas for incomplete uploads across restarts, limits each identity to three incomplete uploads and 1 GB of incomplete data, expires abandoned ownership after 24 hours, and removes stale managed `.part` files. The framework multipart parser still buffers an individual request, so deployments must also enforce a request-body limit of about 74 MB at the ingress proxy. An ingress limit remains required because a malicious client can lie about `Content-Length` or stream differently at a proxy/runtime boundary.

## Optional telemetry

Telemetry is off unless an operator sets a PostHog project token under **Settings → Telemetry** (with an optional self-hosted or regional host). The browser SDK initializes from that runtime setting, so no telemetry is baked into the published image.

Telemetry uses the internal user ID as its pseudonymous identity and records operational event metadata such as request IDs, quantities, status transitions, file counts, sizes, and errors. It does not intentionally send email addresses, user names, request names, or file names.
