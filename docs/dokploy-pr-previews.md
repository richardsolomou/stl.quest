# Dokploy pull request preview migration

This document tracks the planned migration from Cloudflare Containers to an existing self-hosted Dokploy server. Cloudflare remains the active preview platform until the Dokploy path passes the same deployment, browser, access-control, and cleanup checks.

## Security boundary

Do not enable Dokploy's built-in preview deployment webhook for this public repository. Dokploy warns that external contributors can otherwise execute builds and deployments on the server.

GitHub Actions remains the trust boundary. A preview deployment may only run when `github.event.pull_request.head.repo.full_name == github.repository`, so maintainer branches deploy automatically and forked code never reaches Dokploy. The Dokploy API token must be stored as a GitHub Actions secret and scoped to the preview application only when the installed Dokploy version supports that scope.

## Target lifecycle

1. A pull request from a branch in this repository triggers the preview workflow.
2. GitHub requests a Dokploy deployment for that branch without exposing credentials to the built application.
3. Dokploy builds the existing `Dockerfile`, starts it on port 3000, and supplies the generated public URL through `DOKPLOY_DEPLOY_URL`.
4. The preview starts with disposable `/data` and `/prints` storage and runs `.output/server/seed-preview.mjs` before the application entrypoint.
5. The workflow waits for `/api/health`, signs in through the real public URL, and verifies the seeded board.
6. The workflow posts or updates one pull request comment with the preview URL.
7. Closing or merging the pull request removes the Dokploy deployment and its disposable volumes. A scheduled reconciliation removes orphaned previews after failed cleanup runs.

## Installation details required

- Dokploy version and base URL.
- Whether `richardsolomou/stl.quest` is already connected through the Dokploy GitHub provider.
- Preview project, environment, application, and server identifiers.
- Whether previews run on the production host or a separate worker.
- Wildcard preview domain and DNS status, or confirmation that generated `traefik.me` domains are acceptable.
- Authentication protecting preview URLs and whether CI can receive dedicated non-interactive credentials.
- Maximum concurrent previews and CPU, memory, and disk limits.
- API token capabilities available in the installed version.

Do not put API tokens, authentication credentials, server addresses containing credentials, or other secrets in this file or the pull request. Store final values in GitHub Actions secrets.

## Migration completion

- Maintainer pull requests deploy without manual approval or labels.
- Fork pull requests cannot start Dokploy builds or access Dokploy credentials.
- Each preview has isolated disposable SQLite and model storage.
- The generated public URL is trusted by Better Auth and protected from unauthenticated access.
- The seeded browser journey passes against a live Dokploy deployment.
- Updates replace the existing preview instead of creating duplicates.
- Pull request closure deletes the deployment and volumes.
- Orphan cleanup is exercised against a real abandoned preview.
- Cloudflare preview resources and secrets are removed only after the Dokploy lifecycle passes end to end.
