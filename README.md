# PrintHub

Friends upload STL files; a shared realtime Kanban board (To Do → In Progress → Done) tracks every print. Files land as plain STLs on the NAS, organized by status, so `todo/` is always exactly what's left to print.

## How it works

- **App**: TanStack Start (React) in one Docker container on the NAS. Uploads are written straight to the mounted prints folder; dragging a card moves the file between `todo/`, `in-progress/`, and `done/`.
- **Board data**: Convex Cloud holds job metadata and pushes live updates to every open browser. Mutations require a shared secret only the app server knows.
- **Auth**: Cloudflare Tunnel is the only ingress; Cloudflare Access (email allowlist) authenticates friends and injects `Cf-Access-Authenticated-User-Email`. Emails in `ADMIN_EMAILS` can manage the board; everyone else uploads and views.

## Local development

```sh
pnpm install
npx convex dev        # terminal 1: provisions/syncs Convex, keeps types fresh
pnpm dev           # terminal 2: app on http://localhost:3000
```

`.env.local` needs (a dev deployment writes the first two):

```sh
CONVEX_DEPLOYMENT=...
VITE_CONVEX_URL=https://<deployment>.convex.cloud
CONVEX_URL=https://<deployment>.convex.cloud
CONVEX_ACTION_SECRET=<random hex, must match APP_WRITE_SECRET on the deployment>
PRINTS_DIR=./prints-dev          # defaults to /prints (the container mount) when unset
ADMIN_EMAILS=you@example.com
DEV_USER_EMAIL=you@example.com   # fakes the Cloudflare Access header locally
```

Set the write secret on the deployment once: `npx convex env set APP_WRITE_SECRET <value>`.

## Deploying to the NAS (HexOS / TrueNAS SCALE)

TrueNAS custom apps pull a prebuilt image rather than building on the NAS. Every push to `main` builds and publishes the image via GitHub Actions — the workflow reads the `VITE_CONVEX_URL` repo variable (baked into the client bundle at build time) and tags each build `latest`, `v<package.json version>`, and `sha-<commit>`.

**Updating the NAS**: the app runs `:latest` and a Watchtower sidecar (in the same stack, label-scoped so it can't touch other apps) polls GHCR every 5 minutes — pushes to main go live on their own. To roll back, edit the app's image to a previous `vX.Y.Z` or `sha-<commit>` tag; Watchtower ignores pinned tags until you restore `:latest`.

To publish manually instead:

```sh
docker buildx build --platform linux/amd64 \
  --build-arg VITE_CONVEX_URL=https://<prod-deployment>.convex.cloud \
  -t ghcr.io/richardsolomou/printhub:latest --push .
```

1. `npx convex deploy`, then `npx convex env set APP_WRITE_SECRET <value>` on the prod deployment.
2. On the NAS, create the prints folder (`/mnt/HDDs/Applications/print-queue/prints`) — the status folders are created on first upload.
3. Open the underlying TrueNAS UI (HexOS advanced access), go to **Apps → Discover → ⋮ → Install via YAML**, and paste `deploy/hexos-app.yaml` with the placeholders filled in.
4. On the NAS's existing cloudflared tunnel, add a public hostname pointing at `http://<NAS-LAN-IP>:3010`, and add a Cloudflare Access application (email allowlist) on that hostname. LAN devices can reach the port directly and spoof the identity header — acceptable on a trusted home network; add Cf-Access JWT verification if that changes.

For a plain Docker host instead, `docker compose up -d` with `.env` (copy `.env.example`) does the same thing.
