# Pull request previews

Each pull request from a branch in this repository gets its own temporary STL Quest installation on a self-hosted [Dokploy](https://dokploy.com) server. The workflow builds a container image, publishes it as `ghcr.io/richardsolomou/stl.quest-preview:pr-<number>`, and creates or updates a Dokploy application named `stlquest-pr-<number>`.

One comment on the pull request shows the preview's status:

- 🔄 A new version is being built and deployed. The existing preview still shows the previous commit.
- ⏸️ A preview from a fork is waiting for a maintainer to approve its build workflow.
- ✅ The preview is healthy, filled with sample data, and serving the listed commit.
- ❌ Deployment failed. Follow the link to the workflow run for details.
- 🗑️ The preview was removed.

Closing or merging the pull request removes its Dokploy application. A weekly cleanup also removes previews left behind by failed cleanup runs.

Preview data is temporary. Every deployment replaces the container, creates a fresh SQLite database and model folder, adds an administrator, and uploads sample resin and filament requests. Do not enter personal information, private models, or production credentials.

The seeded account is `preview@stl.quest` with password `preview-preview-preview`. Preview URLs use the application's normal authentication and are publicly reachable, so never use production data or credentials in them.

## Dokploy setup

One-time setup on the Dokploy server:

- Create or reuse a Dokploy project and choose an environment for previews. The environment ID is in the environment page URL: `/dashboard/project/<projectId>/environment/<environmentId>`.
- Generate an API key under **Settings → Profile → API/CLI**.
- Point a wildcard DNS record for the preview domain at the Dokploy server, for example `*.stl.quest`.
- Configure a Let's Encrypt certificate email under **Settings → Server** so Traefik can issue certificates.

Each preview is served at `pr-<number>.stl.quest`. The parent domain is hardcoded in `scripts/previewDeploy.ts` and `scripts/previewComment.ts`.

Add these GitHub Actions secrets:

- `DOKPLOY_URL`: the Dokploy base URL, for example `https://dokploy.example.com`
- `DOKPLOY_API_KEY`: the API key generated above
- `DOKPLOY_ENVIRONMENT_ID`: the environment that hosts preview applications
- `PREVIEW_REGISTRY_USERNAME` and `PREVIEW_REGISTRY_PASSWORD` (optional): credentials Dokploy uses to pull the preview image, such as a GitHub username and a token with `read:packages`

The first workflow run creates `ghcr.io/richardsolomou/stl.quest-preview` as a private package. Either make it public or set the registry secrets so Dokploy can pull it.

In the repository's Actions settings, require approval for workflows from all outside collaborators. Pull requests from branches in this repository run automatically and publish their image directly to GHCR. Fork pull requests receive a preview only after a maintainer approves the secret-free image build. A separate trusted workflow publishes and deploys the resulting artifact without exposing repository secrets to contributor code.

To redeploy, push another commit or rerun the workflow. To remove a preview manually, delete its `stlquest-pr-<number>` application in Dokploy or run:

```sh
DOKPLOY_URL=… DOKPLOY_API_KEY=… DOKPLOY_ENVIRONMENT_ID=… PR_NUMBER=123 pnpm exec tsx scripts/previewDeploy.ts delete
```
