# PrintHub

PrintHub is a self-hosted 3D print request queue. Friends — or customers — upload STLs to a Kanban board (To Do → In Progress → Done), and the files stay ordinary files on storage you control. One container, one small database, no cloud services.

- Chunked STL uploads up to 1 GB; thumbnails and decimated viewer previews render on the server, so phones and weak clients never do mesh work.
- Copy-level movement through the board: print 3 of 5, and the file follows its least-finished copies.
- Built-in accounts: the first visitor claims the admin account, admins invite everyone else.
- Live board refresh across browsers through Server-Sent Events.
- Shared or private board mode: friends see each other's requests, or a print farm's customers see only their own.
- Quantity, notes, requester, and source URL on every request.
- Local folder storage by default, S3-compatible object storage (MinIO, R2, B2, Wasabi…) as an option.
- Pluggable Better Auth authentication (password by default; optional Google and Discord OAuth) and optional SMTP email delivery.

PrintHub is MIT licensed. Where the project is headed lives in [VISION.md](VISION.md).

## Install

PrintHub ships as a single Docker image, `ghcr.io/richardsolomou/printhub`, published for amd64 and arm64. Every install is the same shape: mount `/data` (PrintHub's database) and `/prints` (your print files), publish port 3000, open the browser.

**Open the app right after starting it: on a fresh install, the first person to open the web UI claims the admin account.**

### Any Docker host (Linux, Windows, macOS)

```sh
docker run -d --name printhub \
  --user "$(id -u):$(id -g)" \
  --read-only --tmpfs /tmp:size=256m,mode=1777 \
  -p 3010:3000 \
  -v /path/to/appdata:/data \
  -v /path/to/prints:/prints \
  ghcr.io/richardsolomou/printhub:latest
```

Or with Compose: clone the repo (or just copy `docker-compose.yml` and `.env.example`), set the two host paths in `.env`, and `docker compose up -d`. On Windows, Docker Desktop paths like `C:\Users\you\prints` work as bind mounts.

The container runs without root and its root filesystem is read-only. Ensure the host directories are writable by the selected UID/GID; Compose defaults to `1000:1000`, configurable with `PUID` and `PGID`.

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

How users reach the app is an ingress choice, not an application dependency: a plain LAN, Tailscale, a Cloudflare Tunnel, or any reverse proxy works. The one requirement is a request-body limit of about 74 MB at the proxy (see Upload limits) — Cloudflare's default 100 MB cap already satisfies it. On a fresh install, create the admin account before exposing the app beyond your network.

## Configuration

`DATA_DIR` (default `/data`) selects app data, `PRINTS_DIR` (default `/prints`) selects default local storage, `ASSET_JOB_CONCURRENCY` (default and maximum `8` in every environment) limits simultaneous thumbnail, preview, and resin-orientation jobs, and `METRICS_TOKEN` optionally protects Prometheus metrics. Product settings — storage backend, board visibility, telemetry, authentication, and email delivery — live in the admin-only **Settings** page and persist in `/data/printhub.sqlite`. Integration secrets are encrypted with `/data/integration-secrets.key` unless `INTEGRATIONS_ENCRYPTION_KEY` is supplied.

Accounts join by invitation: under **Settings → Users** an admin creates a single-use invite (7-day expiry and revocable). If SMTP is configured, PrintHub can email it directly; otherwise the admin copies the link. The invitee creates a password account or continues with an enabled Google or Discord provider. Provider accounts inherit the verified provider name and profile image; password accounts use Gravatar when available. There is no open signup mode.

The unauthenticated `/api/health` endpoint returns success only after migrations and recovery finish, SQLite responds, and both storage and the upload staging area accept a write probe. The Docker image uses it as its `HEALTHCHECK`, so `docker ps`, Unraid, and TrueNAS all show real readiness.

## Storage

Persistent paths:

- `/data/printhub.sqlite`: metadata, users, sessions, and settings.
- `/data/uploads`: bounded incomplete chunked uploads, swept after 24 hours (always local, regardless of storage adapter).
- `/prints/todo`, `/prints/in-progress`, `/prints/done`: original STL files (default local storage).
- `/prints/.printhub/previews` and `/prints/.printhub/thumbnails`: derived viewer and card images.

Finished print files live behind a storage adapter the admin picks in **Settings → Storage**: a local folder (default `/prints`) or S3-compatible object storage. Switching adapters requires an empty board and does not migrate existing files. S3 credentials are stored in `/data/printhub.sqlite`, so protect that mount.

Status moves and deletes use a durable SQLite operation journal: filesystem work is idempotent, metadata and the committed journal state change in one transaction, and unfinished operations replay before the app accepts traffic. Managed trash is retried and swept after committed deletes. PrintHub enforces one application process per `/data` directory with an exclusive `printhub.lock` database lease; a second process fails startup, and the operating system releases the lease after a crash or container stop.

Keep `/data` on a local Docker volume, ZFS dataset, or local block filesystem. Do not place `printhub.sqlite` on NFS, SMB, or CIFS: SQLite WAL depends on reliable local locking, and PrintHub logs a startup warning when it detects those filesystems. The database explicitly uses WAL, `synchronous=FULL`, foreign keys, and a five-second busy timeout.

## Upgrades, rollback, backup

A push to `main` publishes `latest`, `v<package version>`, and immutable `sha-<commit>` images. Database migrations run automatically on startup; back up before applying a new image. Rollback by selecting a previous `vX.Y.Z` or `sha-…` image — if a release applied a non-backward-compatible migration, restore the matching database backup as well.

Back up `/data` and `/prints` together. The built-in command creates a consistent online SQLite copy while PrintHub is running. It writes to a temporary file, verifies the copy with `PRAGMA quick_check`, flushes it, and atomically renames it into place:

```sh
pnpm backup --output /path/to/printhub.sqlite
```

When running the published container, execute the same command inside it and write the output under a mounted path. Back up print storage at the same logical point. For a fully offline backup, stop the app and copy both directories; SQLite WAL files next to `printhub.sqlite` are part of a live database, so never copy only the main live file.

Keep versioned backups off the PrintHub host and periodically restore one into a disposable container. A backup that has never been restored is not a verified recovery plan.

Coming from the Convex-backed PrintHub? [MIGRATION.md](MIGRATION.md) walks through exporting Convex and importing requests, users, thumbnails, and previews with `pnpm migrate:convex` — your files never move off the NAS.

## Upload limits

PrintHub accepts sequential multipart chunks up to 64 MB and an assembled STL up to 1 GB. It requires a valid `Content-Length` and rejects oversized declared request bodies before multipart parsing, limits concurrent multipart parsing, persists ownership and quotas for incomplete uploads across restarts, limits each identity to three incomplete uploads and 1 GB of incomplete data, expires abandoned ownership after 24 hours, and removes stale managed `.part` files. The framework multipart parser still buffers an individual request, so deployments must also enforce a request-body limit of about 74 MB at the ingress proxy. An ingress limit remains required because a malicious client can lie about `Content-Length` or stream differently at a proxy/runtime boundary.

## Telemetry

PrintHub reports anonymous usage events to its developers' PostHog instance so we can see how installs are used. Telemetry is on by default; admins can turn it off under **Settings → Telemetry**, which stops server events immediately and browser events on the next page load.

Telemetry uses the internal user ID as its pseudonymous identity and records operational event metadata such as request IDs, quantities, status transitions, file counts, sizes, and errors. It does not intentionally send email addresses, user names, request names, or file names.

## Authentication

Better Auth owns PrintHub users, sessions, passwords, OAuth account linking, and sign-in callbacks. Password authentication is the zero-configuration default. Admins can configure Google and Discord directly under **Settings → Integrations**; no separate identity service is required. Multiple methods can be enabled together, and passwords can only be disabled after the current admin has linked an enabled provider. `AUTH_PASSWORD_RECOVERY=true` temporarily forces password sign-in back on if an OAuth-only installation is locked out.

Existing users manage their own sign-in methods under **Settings → Account**. Password users can explicitly link Google or Discord, and OAuth users can create a password for their canonical PrintHub email address. Because linking starts from a fresh authenticated PrintHub session and completes the provider's OAuth verification, the linked provider may use a different email address. Implicit cross-email linking remains disabled, provider identities cannot be moved between existing PrintHub users, and linking never changes the canonical PrintHub email. Linking may refresh the stored display name and profile image.

The web UI is the preferred configuration path. Deployment variables are optional read-only overrides for managed installations:

| Variables                                               | Purpose                                           |
| ------------------------------------------------------- | ------------------------------------------------- |
| `AUTH_PASSWORD_ENABLED`                                 | Force built-in password authentication on or off. |
| `AUTH_PASSWORD_RECOVERY`                                | Force passwords on for emergency recovery.        |
| `AUTH_GOOGLE_CLIENT_ID` / `AUTH_GOOGLE_CLIENT_SECRET`   | Enable Google sign-in.                            |
| `AUTH_DISCORD_CLIENT_ID` / `AUTH_DISCORD_CLIENT_SECRET` | Enable Discord sign-in.                           |

OAuth callbacks use `/api/auth/callback/<provider>`, for example `/api/auth/callback/google`.

## Outbound email

SMTP is optional. Configure it under **Settings → Integrations** to email invitations directly and enable self-service password resets. Without SMTP, admins can still copy invite links and reset passwords from **Settings → Users**.

Managed deployments can configure SMTP with `EMAIL_FROM`, `SMTP_HOST`, optional `SMTP_PORT` (default `587`), `SMTP_SECURE`, `SMTP_USER`, and `SMTP_PASSWORD`. Environment configuration is read-only in the UI.

Database backups that contain integration settings must travel with `integration-secrets.key`; the bundled backup command writes a matching key file next to the SQLite backup. If `INTEGRATIONS_ENCRYPTION_KEY` is used, back up that deployment secret separately.

## Development

Requirements: Node 22+ and pnpm 10.33+.

```sh
pnpm install
DATA_DIR=./data-dev pnpm dev
```

Open `http://localhost:3000`. On a fresh database, the first completed setup becomes the admin. Every later account requires a single-use invite. Storage defaults to `/prints`, which usually is not writable on a dev machine — the app still boots (health stays red) so you can point **Settings → Storage** at an absolute path like `$PWD/prints-dev`.

The source layout mirrors the architecture in [VISION.md](VISION.md): `src/core` is isomorphic domain code, `src/adapters` implements the core's storage/authentication/email/event/telemetry boundaries, `src/server` is the composition root and HTTP guards, `src/client` is everything browser-side, and `src/routes` stays thin glue. Authentication is [better-auth](https://better-auth.com) with the admin plugin and optional social providers; SQLite runs in WAL mode with numbered migrations.

See [CONTRIBUTING.md](CONTRIBUTING.md) for checks and pull-request expectations.

## Development checks

PrintHub uses [Oxlint](https://oxc.rs/docs/guide/usage/linter.html) for type-aware linting and [Oxfmt](https://oxc.rs/docs/guide/usage/formatter.html) for formatting.

```bash
pnpm format       # write formatting
pnpm lint         # type-aware lint checks
pnpm typecheck
pnpm test
pnpm test:e2e     # Playwright; install once with pnpm test:e2e:install
pnpm check        # all non-browser CI checks
```

## Operations

- `GET /api/health` checks SQLite, upload staging, and configured storage. If storage was temporarily unavailable, the health check attempts to reconnect and resumes pending asset jobs.
- **Settings → Diagnostics** shows storage readiness, queue depth, incomplete uploads, SQLite integrity/size, version, and free disk capacity.
- `GET /api/metrics` exposes Prometheus metrics for API requests, SSE clients, incomplete uploads, storage failures, SQLite health, disk capacity, the asset queue, and Node.js process health. Set `METRICS_TOKEN` to require `Authorization: Bearer <token>`.
- SQLite runs a quick integrity check, query-planner optimization, and passive WAL checkpoint on startup. Upload creation rejects requests with HTTP 507 before local staging would consume the final 256 MiB or required upload space.
- API responses include `X-Request-Id`. Supplying that header preserves the caller's ID in structured Pino logs and the response.
- `SIGINT` and `SIGTERM` stop new singleton use, close SSE streams, wait for queued asset jobs, and close SQLite cleanly.
- `PRINTS_DIR` overrides the default `/prints` local-storage mount, which is useful for development and automated tests.

Browser fonts are bundled and served locally. Responses include CSP, clickjacking, MIME-sniffing, referrer, and permissions security headers. Published images include SBOM and provenance attestations; CI scans high/critical image CVEs and reviews dependency changes. The scheduled storage contract runs against a pinned MinIO release.
