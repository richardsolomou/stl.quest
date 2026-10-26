# Pull request previews

Each pull request from a branch in this repository gets its own temporary STL Quest installation on a self-hosted [Dokploy](https://dokploy.com) server. Its local deployment script is only the product hook for Stripe, managed storage, and preview seeding. The shared workflow builds a container image, publishes it alongside production images as `ghcr.io/richardsolomou/stl.quest:preview-pr-<number>-sha-<commit>`, and creates or updates a Dokploy application named `stlquest-pr-<number>`.

The immutable preview tag identifies both the pull request and commit. Dokploy stores that exact image reference on the application, showing which commit is live, and the deployment workflow writes the reference to its job summary before deploying it.

Closing or merging the pull request removes its Dokploy application, immutable preview images, stored models, and Stripe test customers, subscriptions, and webhook endpoint. A weekly cleanup also removes previews and images left behind by failed cleanup runs.

Preview data is temporary. Every deployment replaces the container, creates a fresh SQLite database and model folder, adds an administrator, and uploads sample resin and filament requests. Do not enter personal information, private models, or production credentials.

The seeded account is `preview@stl.quest` with password `preview-preview-preview`; sign in at `/sign-in`, because a preview's `/` shows signed-out visitors the hosted landing page. Preview URLs use the application's normal authentication and are publicly reachable, so never use production data or credentials in them.

## Hosted mode and billing

Previews run as hosted deployments (`STLQUEST_HOSTED=true`) so managed storage, workspace limits, and plan quotas behave the way they do on the hosted service.

Managed storage and Stripe are optional. A preview deploys without them, with billing switched off, when their secrets are absent.

Point the storage secrets at a bucket reserved for previews, never the production bucket. Object keys are namespaced below `previews/pr-<number>`, but that isolation is enforced by the application rather than by the credential — S3 and R2 tokens grant a whole bucket, so a preview holding a production credential can reach every object in it.

Deleting or pruning a preview clears its prefix, so stored models do not outlive the pull request. The prefix comes from the same helper the deploy uses, and a deletion refuses to run against a prefix that does not name the pull request.

Each deploy replaces the pull request's Stripe webhook endpoint at `https://pr-<number>.stl.quest/api/auth/stripe/webhook` and writes the new signing secret into the preview's environment. Stripe reveals a signing secret only when an endpoint is created, so endpoints are recreated rather than reused. Deleting or pruning a preview deletes its endpoint. Use Stripe test mode keys.

Stripe customers created in a preview carry its pull request number as metadata. Redeploying or deleting that preview deletes only customers with the matching marker, which also cancels their subscriptions. Other open pull requests are unaffected even though every preview uses `preview@stl.quest`.

Add one optional `PREVIEW_APP_SECRETS` GitHub Actions secret containing a JSON object. Supported keys are `STLQUEST_HOSTED_STORAGE_BUCKET`, `STLQUEST_HOSTED_STORAGE_ENDPOINT`, `STLQUEST_HOSTED_STORAGE_REGION`, `STLQUEST_HOSTED_STORAGE_ACCESS_KEY_ID`, `STLQUEST_HOSTED_STORAGE_SECRET_ACCESS_KEY`, `STLQUEST_HOSTED_STORAGE_PREFIX`, `STLQUEST_HOSTED_STORAGE_FORCE_PATH_STYLE`, `STRIPE_SECRET_KEY`, `STRIPE_SUPPORTER_PRICE_ID`, and `STRIPE_PRO_PRICE_ID`. Use preview-only storage and Stripe test-mode values. Omitting the secret disables managed preview storage and billing.

## Repository configuration

Follow the [shared preview setup](https://github.com/richardsolomou/ras-stack/blob/main/docs/repository-tooling.md#dokploy-previews) for the Dokploy environment, Actions secrets, registry authentication, and approval boundary. This application's preview host is `pr-<number>.stl.quest`; route the wildcard domain to the preview server and retain HTTPS certificate configuration for that domain.

Preview images use the existing `ghcr.io/richardsolomou/stl.quest` package. If that package is private, set the registry secrets so Dokploy can pull it.

To redeploy, push another commit or rerun the workflow. To remove a preview manually, delete its `stlquest-pr-<number>` application in Dokploy or run the same local product hook used by the shared workflow:

```sh
DOKPLOY_URL=… DOKPLOY_API_KEY=… DOKPLOY_ENVIRONMENT_ID=… PREVIEW_APPLICATION_PREFIX=stlquest PREVIEW_DOMAIN=stl.quest PREVIEW_PORT=3000 PR_NUMBER=123 pnpm exec tsx scripts/previewDeploy.ts delete
```
