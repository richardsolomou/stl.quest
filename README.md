# PrintHub

PrintHub is a self-hosted 3D print request queue. Friends — or customers — upload STLs to a Kanban board (To Do → In Progress → Done), and the files stay ordinary files on storage you control. One container, one small database, no cloud services.

- Chunked STL uploads up to 1 GB; thumbnails and decimated viewer previews render on the server, so phones and weak clients never do mesh work.
- Copy-level movement through the board: print 3 of 5, and the file follows its least-finished copies.
- Built-in accounts: the first visitor claims the operator account, operators invite everyone else.
- Live board refresh across browsers through Server-Sent Events.
- Shared or private board mode: friends see each other's requests, or a print farm's customers see only their own.
- Quantity, notes, requester, and source URL on every request.
- Local folder storage by default, S3-compatible object storage (MinIO, R2, B2, Wasabi…) as an option.

PrintHub is MIT licensed. Where the project is headed lives in [VISION.md](VISION.md).

## Install

PrintHub ships as a single Docker image, `ghcr.io/richardsolomou/printhub`, published for amd64 and arm64. Every install is the same shape: mount `/data` (PrintHub's database) and `/prints` (your print files), publish port 3000, open the browser.

**Open the app right after starting it: on a fresh install, the first person to open the web UI claims the operator account.**

### Any Docker host (Linux, Windows, macOS)

```sh
docker run -d --name printhub \
  -p 3010:3000 \
  -v /path/to/appdata:/data \
  -v /path/to/prints:/prints \
  ghcr.io/richardsolomou/printhub:latest
```

Or with Compose: clone the repo (or just copy `docker-compose.yml` and `.env.example`), set the two host paths in `.env`, and `docker compose up -d`. On Windows, Docker Desktop paths like `C:\Users\you\prints` work as bind mounts.

### Unraid

Add the template from [`deploy/unraid/printhub.xml`](deploy/unraid/printhub.xml): drop it into `/boot/config/plugins/dockerMan/templates-user/` (or paste its contents into **Docker → Add Container → Template**), then fill in the print files share. App data defaults to `/mnt/user/appdata/printhub`.

### TrueNAS SCALE

**Apps → Discover Apps → Custom App**:

- Image: `ghcr.io/richardsolomou/printhub`, tag `latest`, pull policy **Always**, restart **Unless Stopped**.
- Host path for `/data` (for example `/mnt/tank/apps/printhub`) and host path for `/prints` (your STL dataset).
- Port: container `3000`, host `3010`.

TrueNAS can monitor the `latest` tag for updates, and the image's built-in health check reflects real readiness (database migrated, storage writable).

### HexOS

HexOS runs on TrueNAS SCALE, so the TrueNAS custom app instructions apply: create a custom app with the image, the two host paths, and the port mapping.

### Remote access

How users reach the app is an ingress choice, not an application dependency: a plain LAN, Tailscale, a Cloudflare Tunnel, or any reverse proxy works. The one requirement is a request-body limit of about 74 MB at the proxy (see Upload limits) — Cloudflare's default 100 MB cap already satisfies it. On a fresh install, create the operator account before exposing the app beyond your network.

## Configuration

`DATA_DIR` (default `/data`) is the only environment variable the app reads. Everything else — storage backend, board visibility, telemetry — lives in the operator-only **Settings** page and persists in `/data/printhub.sqlite`.

Accounts are built-in email and password: operators add users (and can reset their passwords) under **Settings → Users**. OAuth sign-in (Google, Discord…) is planned; see [VISION.md](VISION.md).

The unauthenticated `/api/health` endpoint returns success only after migrations and recovery finish, SQLite responds, and both storage and the upload staging area accept a write probe. The Docker image uses it as its `HEALTHCHECK`, so `docker ps`, Unraid, and TrueNAS all show real readiness.

## Storage

Persistent paths:

- `/data/printhub.sqlite`: metadata, users, sessions, and settings.
- `/data/uploads`: bounded incomplete chunked uploads, swept after 24 hours (always local, regardless of storage adapter).
- `/prints/todo`, `/prints/in-progress`, `/prints/done`: original STL files (default local storage).
- `/prints/.printhub/previews` and `/prints/.printhub/thumbnails`: derived viewer and card images.

Finished print files live behind a storage adapter the operator picks in **Settings → Storage**: a local folder (default `/prints`) or S3-compatible object storage. Switching adapters requires an empty board and does not migrate existing files. S3 credentials are stored in `/data/printhub.sqlite`, so protect that mount.

Status moves and deletes use a durable SQLite operation journal: filesystem work is idempotent, metadata and the committed journal state change in one transaction, and unfinished operations replay before the app accepts traffic. Managed trash is retried and swept after committed deletes. PrintHub currently supports one application process; its SQLite connection, upload registry and SSE event bus are process-local.

## Upgrades, rollback, backup

A push to `main` publishes `latest`, `v<package version>`, and immutable `sha-<commit>` images. Database migrations run automatically on startup; back up before applying a new image. Rollback by selecting a previous `vX.Y.Z` or `sha-…` image — if a release applied a non-backward-compatible migration, restore the matching database backup as well.

Back up `/data` and `/prints` together. For a consistent manual backup, stop the app first, copy both directories, then start it again. SQLite WAL files next to `printhub.sqlite` are part of a live database; do not copy only the main file while the app is running.

Coming from the Convex-backed PrintHub? [MIGRATION.md](MIGRATION.md) walks through exporting Convex and importing requests, users, thumbnails, and previews with `pnpm migrate:convex` — your files never move off the NAS.

## Upload limits

PrintHub accepts sequential multipart chunks up to 64 MB and an assembled STL up to 1 GB. It requires a valid `Content-Length` and rejects oversized declared request bodies before multipart parsing, limits concurrent multipart parsing, persists ownership and quotas for incomplete uploads across restarts, limits each identity to three incomplete uploads and 1 GB of incomplete data, expires abandoned ownership after 24 hours, and removes stale managed `.part` files. The framework multipart parser still buffers an individual request, so deployments must also enforce a request-body limit of about 74 MB at the ingress proxy. An ingress limit remains required because a malicious client can lie about `Content-Length` or stream differently at a proxy/runtime boundary.

## Telemetry

PrintHub reports anonymous usage events to its developers' PostHog instance so we can see how installs are used. Telemetry is on by default; operators can turn it off under **Settings → Telemetry**, which stops server events immediately and browser events on the next page load.

Telemetry uses the internal user ID as its pseudonymous identity and records operational event metadata such as request IDs, quantities, status transitions, file counts, sizes, and errors. It does not intentionally send email addresses, user names, request names, or file names.

## Development

Requirements: Node 22+ and pnpm 10.33+.

```sh
pnpm install
DATA_DIR=./data-dev pnpm dev
```

Open `http://localhost:3000`. A fresh database shows a welcome form; whoever submits it first becomes the operator. Storage defaults to `/prints`, which usually is not writable on a dev machine — the app still boots (health stays red) so you can point **Settings → Storage** at an absolute path like `$PWD/prints-dev`.

The source layout mirrors the architecture in [VISION.md](VISION.md): `src/core` is isomorphic domain code, `src/adapters` implements the core's storage/event/telemetry boundaries, `src/server` is the composition root and HTTP guards, `src/client` is everything browser-side, and `src/routes` stays thin glue. Authentication is [better-auth](https://better-auth.com) (email/password with the admin plugin); SQLite runs in WAL mode with numbered migrations.

See [CONTRIBUTING.md](CONTRIBUTING.md) for checks and pull-request expectations.
