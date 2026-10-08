# End-to-end testing

STL Quest uses Playwright to test the production container, including its bundled realtime service and same-origin proxy, against temporary data and model-storage directories. Docker and just 1.58.0 must be available.

Install Chromium once:

```sh
just e2e-install
```

Run the complete suite:

```sh
just e2e
```

Use `CI=1 just e2e` to match CI reporting and trace behavior. For faster reruns against the current `stlquest-e2e` image, use `just e2e-run`. Set `PLAYWRIGHT_DEV_SERVER=1` only when debugging against an existing `just dev` process.

Run the distributed realtime topology separately:

```sh
just e2e-distributed
```

This starts temporary PostgreSQL and Redis containers, two complete STL Quest replicas, and S3-compatible staging. It pins one browser to each replica and verifies shared presence and realtime delivery across replica and Redis restarts.

Other useful commands:

```sh
just e2e --grep "<title fragment>"
just e2e-screenshots
just e2e-trace
```

The screenshot command writes journey images to `test-results/manual-inspection/` and the direct-HTTP sign-in image to `test-results/auth-http-success.png`. The trace command records a Playwright trace. Normal local and CI runs do not create these manual-review screenshots.

## Suite structure

`e2e/00-stlquest.spec.ts` is the main sequential journey through onboarding, storage, printers, workspaces, uploads, settings, and invitations. Add broad workflow coverage at the matching point in this journey.

Use a separate spec when a scenario needs isolated state or a different server setup. Current examples cover request ordering and multiple browser sessions, account settings, direct self-hosted HTTP sign-in, HTTPS authentication and realtime behind an outer proxy, and seeded preview deployments.

`playwright.config.ts` starts the normal test server and isolated production containers for direct HTTP, an HTTPS outer-proxy chain, hosted mode, and preview seeding. Each deployment-specific spec runs only against its matching server; the remaining specs run in the Chromium project.

CI runs every Chromium-project spec against the core server only (`PLAYWRIGHT_CORE_ONLY=1`), split across the `E2E (core)` and `E2E (ordering)` shards in `.github/workflows/docker.yml`, plus the distributed topology. A new Chromium-project spec must be added to one of those shards and to `just e2e-ci`. Pull requests run the shards against the fast non-Docker server. On `main` and manual runs, CI builds the multi-architecture release image once, with the pending release version and production build arguments, and pushes it to GHCR as `candidate-<commit>`. The shards, `E2E (distributed)`, `E2E (deployments)`, and `container-security` all pull that digest, and publishing retags the same digest instead of rebuilding. Pull requests instead build the `Build test image` artifact for `E2E (deployments)` and `container-security`, because the deployment-specific projects need their extra production containers. The release image bakes in telemetry settings, so `scripts/e2eContainerArgs.sh` clears them and blocks the telemetry host for every E2E container. A new deployment-specific project must be added to that job and to `just e2e-ci`.

`playwright.distributed.config.ts` owns the isolated two-replica topology. Keep infrastructure lifecycle in `scripts/distributedRealtimeE2e.sh` so local and CI runs exercise the same setup.

Specs import `test` and `expect` from `e2e/fixtures/test.ts`. Its automatic fixture attaches diagnostics from the test's default browser context to every failed test: console errors and warnings, page errors, failed and unfinished requests, HTTP error responses, and each open page's load and hydration state. CI also uploads `test-results/`, including traces and screenshots, as an artifact when an E2E job fails.

`e2e/fixtures/stl.ts` creates STL box geometry with `boxStl(name, width, depth, height)`. Static binary fixtures are reserved for oversized files and other edge cases.

## Shared state and retries

Keep `workers: 1`, `fullyParallel: false`, and retries disabled. The journey changes its own database, so a retry would run against leftover state and would not prove that the test is reliable.

Fix intermittent tests by waiting for visible state rather than fixed delays. Notification and navigation timing have caused most past failures.
