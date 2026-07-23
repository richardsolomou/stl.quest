# Pull request previews

Pull requests from branches in this repository deploy an isolated STL Quest container to a self-hosted [Dokploy](https://dokploy.com) server. The workflow builds the pull request's image, pushes it to GitHub Container Registry as `ghcr.io/richardsolomou/stl.quest-preview:pr-<number>`, and creates or updates a Dokploy application named `stlquest-pr-<number>` with its own domain. A single pull request comment tracks the deployment: 🔄 while a new version is building and deploying (the running preview is stale until then), ✅ with the commit it serves once the container is healthy and seeded, ❌ with a workflow-run link if the deployment failed, and 🗑️ once the preview is removed. Closing or merging the pull request deletes the Dokploy application. A weekly workflow removes orphaned previews whose cleanup run failed.

Preview storage is intentionally disposable. Each deployment starts with a fresh SQLite database and local model store, creates a preview administrator, and uploads representative resin and filament requests. Every deployment replaces the container, which resets that data. Never put personal information, private models, or production credentials in a preview.

The seeded account is `preview@stl.quest` with password `preview-preview-preview`. Basic authentication, enforced by Dokploy's Traefik proxy, must protect preview URLs so these shared credentials are only usable by the team.

## Dokploy setup

One-time setup on the Dokploy server:

- Create (or reuse) a Dokploy project and pick an environment in it to host previews. The environment ID is in the environment page URL: `/dashboard/project/<projectId>/environment/<environmentId>`.
- Generate an API key in Dokploy under Settings → Profile → API/CLI.
- Point a wildcard DNS record for the preview domain at the Dokploy server, for example `*.stl.quest`.
- Configure a Let's Encrypt certificate email in Dokploy's Settings → Server so Traefik can issue certificates for preview domains.

The repository needs these GitHub Actions secrets:

- `DOKPLOY_URL`: the base URL of the Dokploy instance, for example `https://dokploy.example.com`.
- `DOKPLOY_API_KEY`: the API key generated above.
- `DOKPLOY_ENVIRONMENT_ID`: the environment that hosts the preview applications.
- `PREVIEW_DOMAIN`: the parent domain for previews; each preview is served at `pr-<number>.<PREVIEW_DOMAIN>`, so `PREVIEW_DOMAIN=stl.quest` serves pull request 123 at `pr-123.stl.quest`.
- `PREVIEW_BASIC_AUTH_USERNAME` and `PREVIEW_BASIC_AUTH_PASSWORD`: the shared credentials Traefik requires before any preview is reachable.
- `PREVIEW_REGISTRY_USERNAME` and `PREVIEW_REGISTRY_PASSWORD` (optional): credentials Dokploy uses to pull the preview image, for example a GitHub username and a personal access token with `read:packages`. Leave both unset once the `stl.quest-preview` package is public.

The first workflow run creates `ghcr.io/richardsolomou/stl.quest-preview` as a private package. Either make it public in the package settings or set the registry secrets above so the Dokploy server can pull it.

In the repository's Actions settings, require approval for workflows from all outside collaborators. Maintainer-authored workflows run automatically, while a maintainer must approve workflows submitted by external contributors.

The workflow names Dokploy applications `stlquest-pr-<number>`. Pull requests from forks do not receive previews after approval because the workflow only deploys branches in this repository and GitHub does not expose deployment secrets to forked code.

To redeploy, push another commit or rerun the workflow. To remove a preview manually, delete the `stlquest-pr-<number>` application in the Dokploy dashboard, or run:

```sh
DOKPLOY_URL=… DOKPLOY_API_KEY=… DOKPLOY_ENVIRONMENT_ID=… PR_NUMBER=123 pnpm exec tsx scripts/dokployPreview.ts delete
```
