# End-to-end testing

STL Quest uses Playwright to test production builds against temporary data and model-storage directories.

Install Chromium once:

```sh
pnpm test:e2e:install
```

Run the complete suite:

```sh
pnpm test:e2e
```

Use `CI=1 pnpm test:e2e` to match CI reporting and trace behavior. For faster reruns against the current production build, use `pnpm test:e2e:run`. Set `PLAYWRIGHT_DEV_SERVER=1` only when debugging against Vite.

Other useful commands:

```sh
pnpm test:e2e --grep "<title fragment>"
pnpm test:e2e:screenshots
pnpm test:e2e:trace
```

The screenshot command writes journey images to `test-results/manual-inspection/` and the direct-HTTP sign-in image to `test-results/auth-http-success.png`. The trace command records a Playwright trace. Normal local and CI runs do not create these manual-review screenshots.

## Suite structure

`e2e/00-stlquest.spec.ts` is the main sequential journey through onboarding, storage, printers, workspaces, uploads, settings, and invitations. Add broad workflow coverage at the matching point in this journey.

Use a separate spec when a scenario needs isolated state or a different server setup. Current examples cover request ordering and multiple browser sessions, account settings, direct self-hosted HTTP sign-in, and seeded preview deployments.

`playwright.config.ts` starts the normal test server and a separate self-hosted HTTP server. `auth-http.spec.ts` runs only against the HTTP server; the other specs run in the Chromium project.

`e2e/fixtures/stl.ts` creates STL box geometry with `boxStl(name, width, depth, height)`. Static binary fixtures are reserved for oversized files and other edge cases.

## Shared state and retries

Keep `workers: 1`, `fullyParallel: false`, and retries disabled. The journey changes its own database, so a retry would run against leftover state and would not prove that the test is reliable.

Fix intermittent tests by waiting for visible state rather than fixed delays. Notification and navigation timing have caused most past failures.
