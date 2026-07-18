# PrintHub — Agent Guide

Read [CONTRIBUTING.md](CONTRIBUTING.md) first: it defines the layout (`src/core` isomorphic domain → `src/adapters`/`src/db` → `src/server`/`src/client`/`src/routes`), database rules, and release-note policy. This file adds the operational detail that isn't obvious from reading it.

## Commands

- `pnpm check` — the full local gate (format, lint, `db:check`, build, typecheck, unit tests, CLI smoke). The build runs **before** typecheck because it generates `src/routeTree.gen.ts`; on a fresh clone, typecheck fails until you build.
- Dev server: `DATA_DIR=./data-dev PRINTS_DIR=./prints-dev BETTER_AUTH_URL=http://localhost:3000 pnpm dev` (create the two dirs first).
- Unit tests: `pnpm test`. Vitest runs with `fileParallelism: false` because of the `globalThis.__printhub` app singleton and shared SQLite state — don't assume isolation across test files.
- E2E: `CI=1 pnpm test:e2e` (see the `extending-e2e` skill). Install Chromium once with `pnpm test:e2e:install`.
- Lint/format is oxlint + oxfmt (`pnpm lint`, `pnpm format`), not ESLint/Prettier. Warnings are denied in CI.
- Toolchain: Node 24.x only (`engines` pins `>=24 <25`), pnpm 11.12+ via the `packageManager` field.

## Load-bearing rules

- **Server functions** (`src/server/fns.ts`): wrap every handler body in `rpc()` — thrown `Response` objects (the service's 400/403/404/409s) otherwise reach the client as a _successful_ result. Every mutation calls `requireMutationOrigin()` before touching state; CSRF protection is per-function, not middleware. See the `adding-server-functions` skill.
- **Authorization lives in server functions**, not routes. Route `beforeLoad`/`useEffect` redirects are UX only.
- **Workspace isolation is absolute**: every tenant table carries `workspace_id` with a composite FK to its parent; every `DrizzleRepository` (`src/db/repository.ts`) method filters via the scoped repository (`scoped(workspaceId)`). New tenant tables and queries must follow suit — there is no bypass path. `docs/workspaces.md` describes the full model.
- **Client queries**: `queryOptions` factories live in `src/client/queries.ts`, never inline. Workspace-scoped query keys must include `workspaceSlug` or data leaks across workspace switches. Invalidation is blanket via the global `/api/events` SSE listener — no bespoke invalidation needed.
- **`AppEvent`** (`src/core/types.ts`) is a closed union treated as a public API: additions are fine, renames/removals are breaking. Server-side state changes publish one, and mutations go through `PrintHubService`, not the repository.
- **Settings, not env vars**: product configuration goes in the `settings` (workspace) or `deployment_settings` (global) tables. Env vars are reserved for filesystem paths, operational controls, recovery, and managed-deployment overrides.
- **CSP is a hardcoded string in `vite.config.ts`** (under `nitro.routeRules`). Any new external image/script/connect source (OAuth avatar CDNs, telemetry hosts) requires editing it — easy to miss.
- **Orientation/footprint analysis changes** must bump `ORIENTATION_ANALYSIS_VERSION` (`src/core/platePlanner.ts`) so existing models reanalyze; stale cached analyses are matched by version.
- **`AssetStore` has a behavioral contract**: `src/adapters/storeContract.test.ts` runs the same suite against the local and S3 stores (S3 gated on `MINIO_TEST_*` env vars) — semantic changes must extend it so both stay equivalent. Crash recovery replays the operation journal (`PrintHubService.resumeOperation`); a new operation kind must extend that state machine and its recovery tests.
- **The asset worker is bundled separately**: `pnpm build` runs `src/server/assets/worker.ts` through its own esbuild pass (not the Vite/Nitro bundle) to `assets-worker.mjs`. New imports there must survive standalone bundling; tests run the queue inline (`process.env.VITEST`), so worker-only breakage won't show in unit tests.
- **Test-mode branches live in production code** on purpose: `NODE_ENV === 'test'` auto-creates a test workspace in the repository, `VITEST` disables worker threads. Don't remove them as dead code, and keep them in mind when touching those paths.
- **`src/core` stays isomorphic** — no IO, no framework imports. Nothing enforces this mechanically; you are the enforcement.
- Validate URLs by parsed hostname (`new URL(...).hostname` with boundary checks), never substring `includes()` — CodeQL runs on every PR and flags this.

## Co-change patterns

- Schema change → `changing-the-database` skill (generate migrations, never edit applied ones).
- Anything an operator configures (env vars, volumes, ports, upload formats) → `shipping-deploy-config` skill (README, `.env.example`, docker-compose, TrueNAS, Unraid all move together).
- Features extend the e2e journey spec and add colocated `*.test.ts`; bug fixes carry a regression test in the same PR.

## Changesets and releases

- Run `pnpm changeset` for any change to released application behavior: one imperative, user-visible sentence (it becomes the CHANGELOG verbatim, often with a "so that" clause), `minor` for new capability, `patch` for fixes. Skip for docs/tests/refactors/tooling only.
- Merging a changeset to `main` releases immediately: version bump, tag, GitHub Release, and container publish (`latest`, `vX.Y.Z`, `sha-…`). There is no release PR, so don't merge a changeset you're not ready to ship.
- `deploy/truenas/printhub/app.yaml`'s version is synced by `scripts/syncReleaseVersion.ts` during release — never bump it by hand.

## Pull requests

- Titles are conventional commits with product-surface scopes (not directories): `planner`, `board`, `queue`, `auth`, `storage`, `admin`, `viewer`, `upload`, `workspaces`, `router`, `csp`, `ci`, `deps`.
- The body follows `.github/pull_request_template.md`: Risk is graded (`Low.`/`Medium.`/`High.`) with an explicit rollback path; Verification lists only commands actually run, with result counts (e.g. `pnpm check` (297 passed, 4 skipped)); inapplicable checklist items are ticked with `(N/A, reason)`.
- Never commit PR screenshots into the repo (a `docs/pr/` folder had to be cleaned up once); attach them to the PR instead.

## Product boundary

Self-hosted request intake and queue management only. Payments, shipping, slicing, printer control, marketplaces, and general-purpose automation stay out of the core application.
