# Running STL Quest locally

Install Node 24.x and pnpm 11.12.0, then install dependencies:

```sh
pnpm install
```

Create local data directories and start the development server:

```sh
mkdir -p data-dev prints-dev
pnpm dev:realtime
```

In another terminal:

```sh
DATA_DIR=./data-dev PRINTS_DIR=./prints-dev BETTER_AUTH_URL=http://localhost:3000 pnpm dev
```

Open `http://localhost:3000`. The first account created becomes the super admin.

To start again with an empty installation, delete `data-dev/` and `prints-dev/`. To test with real data, point `DATA_DIR` at a disposable copy of a production snapshot. The ignored `/local/` directory is the usual place for it. Startup may migrate the database, so never use the original snapshot.

`pnpm dev:realtime` runs the pinned Centrifugo image with its memory engine and development-only signing key. Vite proxies the realtime WebSocket to it. Production bundles the same Centrifugo version in the STL Quest image.

In development, Vite needs the `devApiImages` workaround in `vite.config.ts` to serve `/api/*` image requests. Production does not use this path because Nitro serves the application through one handler.

## Running as a hosted deployment

Managed storage, workspace limits, and plan quotas only apply when `STLQUEST_HOSTED=true`. Set it alongside an S3-compatible bucket to work on those paths:

```sh
DATA_DIR=./data-dev PRINTS_DIR=./prints-dev BETTER_AUTH_URL=http://localhost:3000 \
  STLQUEST_HOSTED=true \
  STLQUEST_HOSTED_STORAGE_BUCKET=stlquest-dev \
  STLQUEST_HOSTED_STORAGE_ENDPOINT=https://account-id.r2.cloudflarestorage.com \
  STLQUEST_HOSTED_STORAGE_ACCESS_KEY_ID=… \
  STLQUEST_HOSTED_STORAGE_SECRET_ACCESS_KEY=… \
  pnpm dev
```

Use a disposable bucket. An S3 or R2 token grants a whole bucket and cannot be scoped to a key prefix.

## Billing

Billing needs `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_SUPPORTER_PRICE_ID`, and `STRIPE_PRO_PRICE_ID` on top of a hosted deployment. Supplying some but not all of them stops the application from starting. Use Stripe test mode keys and prices whose products carry a Managed Payments-eligible tax code.

Forward webhooks with the [Stripe CLI](https://docs.stripe.com/stripe-cli) rather than registering an endpoint, because `localhost` is not reachable from Stripe:

```sh
stripe listen --forward-to localhost:3000/api/auth/stripe/webhook
```

The command prints the signing secret to use as `STRIPE_WEBHOOK_SECRET` for that session. The path belongs to Better Auth's Stripe plugin, which mounts it below the Better Auth handler.

Pay with card `4242 4242 4242 4242` and any future expiry. Subscription state only reaches the database through a webhook, so a plan stays unchanged in the UI while `stripe listen` is not running.

## Checking UI changes

Open the running app and inspect every affected screen. Check both desktop and the 320 px mobile viewport.

Run the screenshot-enabled end-to-end suite when a change affects several screens. See [End-to-end testing](e2e-testing.md) for the command, output locations, suite structure, and debugging guidance. Review the images locally and attach relevant ones to the pull request. Never commit them to the repository.
