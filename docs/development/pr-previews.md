# Pull request previews

Each pull request from a branch in this repository gets its own temporary STL Quest installation on a self-hosted [Dokploy](https://dokploy.com) server. The workflow builds a container image, publishes it as `ghcr.io/richardsolomou/stl.quest-preview:pr-<number>`, and creates or updates a Dokploy application named `stlquest-pr-<number>`.

One comment on the pull request shows the preview's status:

- 🔄 A new version is being built and deployed. The existing preview still shows the previous commit.
- ⏸️ A preview from a fork is waiting for a maintainer to approve its build workflow.
- ✅ The preview is healthy, filled with sample data, and serving the listed commit.
- ❌ Deployment failed. Follow the link to the workflow run for details.
- 🗑️ The preview was removed.

Closing or merging the pull request removes its Dokploy application, its stored models, and its Stripe test customers, subscriptions, and webhook endpoint. A weekly cleanup also removes previews left behind by failed cleanup runs.

Preview data is temporary. Every deployment replaces the container, creates a fresh SQLite database and model folder, adds an administrator, and uploads sample resin and filament requests. Do not enter personal information, private models, or production credentials.

The seeded account is `preview@stl.quest` with password `preview-preview-preview`. Preview URLs use the application's normal authentication and are publicly reachable, so never use production data or credentials in them.

## Hosted mode and billing

Previews run as hosted deployments (`STLQUEST_HOSTED=true`) so managed storage, workspace limits, and plan quotas behave the way they do on the hosted service.

Managed storage and Stripe are optional. A preview deploys without them, with billing switched off, when their secrets are absent.

Point the storage secrets at a bucket reserved for previews, never the production bucket. Object keys are namespaced below `previews/pr-<number>`, but that isolation is enforced by the application rather than by the credential — S3 and R2 tokens grant a whole bucket, so a preview holding a production credential can reach every object in it.

Deleting or pruning a preview clears its prefix, so stored models do not outlive the pull request. The prefix comes from the same helper the deploy uses, and a deletion refuses to run against a prefix that does not name the pull request.

Each deploy replaces the pull request's Stripe webhook endpoint at `https://pr-<number>.stl.quest/api/auth/stripe/webhook` and writes the new signing secret into the preview's environment. Stripe reveals a signing secret only when an endpoint is created, so endpoints are recreated rather than reused. Deleting or pruning a preview deletes its endpoint. Use Stripe test mode keys.

Stripe customers created in a preview carry its pull request number as metadata. Redeploying or deleting that preview deletes only customers with the matching marker, which also cancels their subscriptions. Other open pull requests are unaffected even though every preview uses `preview@stl.quest`.

Add these optional GitHub Actions secrets:

- `PREVIEW_STORAGE_BUCKET`, `PREVIEW_STORAGE_ENDPOINT`, `PREVIEW_STORAGE_REGION`, `PREVIEW_STORAGE_ACCESS_KEY_ID`, `PREVIEW_STORAGE_SECRET_ACCESS_KEY`: the S3-compatible bucket backing managed storage in previews
- `PREVIEW_STORAGE_PREFIX`, `PREVIEW_STORAGE_FORCE_PATH_STYLE` (optional): a parent prefix for preview objects, and path-style requests for providers that require them
- `PREVIEW_STRIPE_SECRET_KEY`, `PREVIEW_STRIPE_SUPPORTER_PRICE_ID`, `PREVIEW_STRIPE_PRO_PRICE_ID`: Stripe test mode key and the monthly Supporter and Pro price IDs

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
