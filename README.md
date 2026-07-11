# PrintHub

PrintHub is a shared STL upload queue for a small group of people. A realtime Kanban board tracks each requested copy through To Do, In Progress, and Done while the original STL stays on NAS storage.

## What it does

- Accepts one or many STL files by picker, dropzone, or a drop anywhere on the board.
- Uploads files up to 1 GB in 32 MB chunks, avoiding Cloudflare's 100 MB request limit.
- Tracks copies independently, so part of a multi-copy job can be printing or finished while the rest remains queued.
- Generates 256 px thumbnails and lightweight viewer STLs in the uploader's browser. Files over 12 MB or meshes over 400,000 triangles are candidates for a preview targeting 100,000 triangles and at most 8 MB.
- Opens the optimized preview first, with an explicit option to load the original full-detail STL. Phones use thumbnails instead of the live 3D viewer.
- Streams STL responses from disk with gzip when supported.
- Identifies users and captures key product actions and application exceptions in PostHog.

## Architecture

- **Web app:** TanStack Start, React, and Three.js in one Node container.
- **Realtime data:** Convex Cloud stores users and job metadata and pushes board updates to connected browsers. Server mutations authenticate with a shared secret.
- **File storage:** The container mounts the NAS prints directory at `/prints`. Original STLs move between `todo/`, `in-progress/`, and `done/`; generated viewer files live in `.previews/`; incomplete chunked uploads temporarily live in `.uploads/` and are eligible for cleanup after 24 hours.
- **Identity:** Cloudflare Access injects `Cf-Access-Authenticated-User-Email`. Members of `ADMIN_EMAILS` can move, reorder, and delete jobs. Other users can upload, view, download, and edit their own unstarted requests.
- **Observability:** PostHog captures identified product events in the browser and server, plus browser exceptions and React render failures. Browser telemetry uses the same-origin `/ingest` proxy configured in Vite.

The STL on disk is the source file and is never replaced by its preview. A job's file lives in the folder for its least-finished copies: it remains in `todo/` while anything is queued and reaches `done/` only when every copy is complete.

## Local development

Requirements: Node 22+, pnpm 10.33+, and a Convex account.

```sh
pnpm install
npx convex dev # terminal 1: provision/sync Convex and regenerate types
pnpm dev       # terminal 2: http://localhost:3000
```

Create `.env.local` with:

```sh
CONVEX_DEPLOYMENT=...
VITE_CONVEX_URL=https://<deployment>.convex.cloud
CONVEX_URL=https://<deployment>.convex.cloud
CONVEX_ACTION_SECRET=<random hex>
PRINTS_DIR=./prints-dev
ADMIN_EMAILS=you@example.com
DEV_USER_EMAIL=you@example.com
VITE_POSTHOG_PROJECT_TOKEN=phc_<project-token>
VITE_POSTHOG_HOST=https://us.i.posthog.com
```

`DEV_USER_EMAIL` substitutes for the Cloudflare header outside production. `PRINTS_DIR` defaults to `/prints` when unset.

Set the same write secret in the selected Convex deployment:

```sh
npx convex env set APP_WRITE_SECRET <same random hex>
```

Useful checks:

```sh
pnpm typecheck
pnpm build
```

## Deployment model

Production has two independently deployed parts:

1. `npx convex deploy` publishes the schema and Convex functions.
2. A push to `main` runs `.github/workflows/docker.yml`, builds the `linux/amd64` app image, and publishes it to GHCR.

The image receives the public Convex and PostHog values at build time because Vite embeds them in the browser bundle. Configure these GitHub repository variables before the first build:

- `VITE_CONVEX_URL`
- `VITE_POSTHOG_PROJECT_TOKEN`
- `VITE_POSTHOG_HOST` (`https://us.i.posthog.com` for US Cloud)

The workflow publishes three tags:

- `latest`, consumed by the NAS Custom App.
- `v<package.json version>`, the human-readable release tag.
- `sha-<full commit SHA>`, the immutable build tag.

### First production deployment as a TrueNAS Custom App

1. Deploy Convex and set its production secret:

   ```sh
   npx convex deploy
   npx convex env set APP_WRITE_SECRET <production secret>
   ```

2. Set the GitHub repository variables listed above and push `main`. Confirm that **Build and push image** publishes `ghcr.io/richardsolomou/printhub:latest`.
3. Create `/mnt/HDDs/STL` on the NAS. PrintHub creates the status and working subdirectories as needed.
4. In TrueNAS, open **Apps → Discover Apps → Custom App** and configure the guided wizard:

   - Application name: `printhub`
   - Image repository: `ghcr.io/richardsolomou/printhub`
   - Tag: `latest`
   - Pull policy: **Always pull image even if present on host**
   - Restart policy: **Unless Stopped**
   - Environment: `CONVEX_ACTION_SECRET=<production secret>` and `ADMIN_EMAILS=<comma-separated admin emails>`
   - TCP port: container `3000`, host `3010`
   - Host-path storage: `/mnt/HDDs/STL` mounted at `/prints`

5. Install the app and verify that `http://<NAS-LAN-IP>:3010` loads.
6. Add a hostname to the NAS's cloudflared tunnel pointing to `http://<NAS-LAN-IP>:3010`, then protect it with a Cloudflare Access application and email allowlist.

TrueNAS can monitor upstream Docker images for both catalog and custom apps. Keep **Apps → Configuration → Settings → Check for docker image updates** enabled so a new `latest` image appears as an available update.

### Normal release

1. Update Convex first with `npx convex deploy` whenever schema or Convex functions changed.
2. Bump `package.json` when the release should receive a new `vX.Y.Z` tag and visible header version.
3. Push to `main` and wait for the image workflow to finish.
4. When TrueNAS reports an image update, open the installed PrintHub app and apply the update.

Deploying Convex first keeps a newly started container from calling functions that have not reached production yet.

### Rollback

Edit the Custom App's image tag and replace `latest` with a known `vX.Y.Z` or `sha-<full commit SHA>` tag. Restore `latest` when it should follow the newest build again.

Container rollback does not roll back the Convex schema or functions. If a release changed Convex incompatibly, deploy the matching Convex revision separately.

## Manual Docker deployment

To build and publish without GitHub Actions:

```sh
docker buildx build --platform linux/amd64 \
  --build-arg VITE_CONVEX_URL=https://<deployment>.convex.cloud \
  --build-arg VITE_POSTHOG_PROJECT_TOKEN=phc_<project-token> \
  --build-arg VITE_POSTHOG_HOST=https://us.i.posthog.com \
  -t ghcr.io/richardsolomou/printhub:latest --push .
```

For a plain Docker host, copy `.env.example` to `.env`, fill it in, and run:

```sh
docker compose up -d --build
```

The Compose stack exposes the app on port 3010 and mounts `PRINTS_HOST_DIR` at `/prints`.

## Operations and security

- Back up both the NAS prints directory and Convex data; neither contains a complete copy of the other.
- The published port trusts the Cloudflare identity header. Devices that can reach port 3010 directly can spoof it, so direct LAN access is appropriate only on a trusted network. Validate Cloudflare Access JWTs before exposing that port to an untrusted network.
- Preview generation is best-effort. If it fails, the original STL remains valid and the viewer loads full detail.
