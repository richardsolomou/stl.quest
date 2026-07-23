# Dokploy pull request preview migration

This document tracks the planned migration from Cloudflare Containers to an existing self-hosted Dokploy server. Cloudflare remains the active preview platform until the Dokploy path passes the same deployment, browser, access-control, and cleanup checks.

## Version gate

Only enable native previews when the installed Dokploy version exposes **Require Collaborator Permissions** in the application preview settings. Keep that setting enabled. Current Dokploy checks the pull request author's repository permission and only builds when the author has write access; older releases without that setting are unsafe for this public repository.

Do not compensate for a missing permission check with shared labels or deployment credentials exposed to pull request code. Keep Cloudflare previews active until the installed Dokploy behavior is verified with both a maintainer branch and an untrusted fork.

## Target lifecycle

1. A pull request against `main` reaches Dokploy through its GitHub provider.
2. Dokploy rejects authors without collaborator write access before starting a build.
3. Dokploy builds the existing `Dockerfile` with the `preview` target, starts it on port 3000, and supplies the generated public URL through `DOKPLOY_DEPLOY_URL`.
4. The `preview` image target seeds disposable `/data` and `/prints` storage before starting the normal production server.
5. Dokploy posts and updates its preview status comment on the pull request.
6. Closing or merging the pull request removes the deployment and its disposable resources.

## Dokploy application

Create a dedicated Dokploy application for STL Quest previews so its build target, storage, environment, and resource limits cannot affect production. Connect `richardsolomou/stl.quest` through the GitHub provider and configure:

- Provider target branch: `main`.
- Build type: Dockerfile.
- Dockerfile path: `Dockerfile`.
- Docker build stage: `preview`.
- Port: `3000`.
- Preview limit: no more than `3`.
- Require Collaborator Permissions: enabled.
- Preview labels: empty, so maintainer pull requests deploy automatically.
- Preview environment: `NODE_ENV=production`, `DATA_DIR=/data`, `PRINTS_DIR=/prints`, and `BETTER_AUTH_URL=https://${{DOKPLOY_DEPLOY_URL}}` when HTTPS is enabled.
- Storage: no shared host mounts; keep `/data` and `/prints` disposable within each preview.

Protect the wildcard preview domain with Dokploy application authentication or an equivalent reverse-proxy policy. CI browser verification will need dedicated non-interactive credentials before it can replace the current Cloudflare Access check.

## Installation details required

- Dokploy version and base URL.
- Whether `richardsolomou/stl.quest` is already connected through the Dokploy GitHub provider.
- Preview project, environment, application, and server identifiers.
- Whether previews run on the production host or a separate worker.
- Wildcard preview domain and DNS status, or confirmation that generated `traefik.me` domains are acceptable.
- Authentication protecting preview URLs and whether CI can receive dedicated non-interactive credentials.
- Maximum concurrent previews and CPU, memory, and disk limits.
- Confirmation that the installed version exposes Require Collaborator Permissions and Docker build-stage selection.

Do not put API tokens, authentication credentials, server addresses containing credentials, or other secrets in this file or the pull request. Store final values in GitHub Actions secrets.

## Migration completion

- Maintainer pull requests deploy without manual approval or labels.
- A fork pull request from a user without write access is rejected before Dokploy starts a build.
- Each preview has isolated disposable SQLite and model storage.
- The generated public URL is trusted by Better Auth and protected from unauthenticated access.
- The seeded browser journey passes against a live Dokploy deployment.
- Updates replace the existing preview instead of creating duplicates.
- Pull request closure deletes the deployment and volumes.
- Orphan cleanup is exercised against a real abandoned preview.
- Cloudflare preview resources and secrets are removed only after the Dokploy lifecycle passes end to end.
