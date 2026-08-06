# STL Quest — Agent Guide

Read [CONTRIBUTING.md](CONTRIBUTING.md) first: it defines the layout (`src/core` isomorphic domain → `src/adapters`/`src/db` → `src/server`/`src/client`/`src/routes`), database rules, and release-note policy. This file adds the operational detail that isn't obvious from reading it.

## Commands

- `just check` — the full local gate (format, lint, `db:check`, `catalog:check`, build, typecheck, unit tests, backup CLI smoke). The build runs **before** typecheck because it generates `src/routeTree.gen.ts`; on a fresh clone, typecheck fails until you build.
- Dev server: `just realtime` in one terminal, then `just dev` in another.
- Unit tests: `just test`. Vitest runs with `fileParallelism: false` because of the `globalThis.__stlquest` app singleton and shared SQLite state — don't assume isolation across test files.
- E2E: `just e2e` builds and tests the production server; `just e2e-run` reruns the current build, and `just e2e-trace` records a local trace (see the `extending-e2e` skill). Install Chromium once with `just e2e-install`; set `PLAYWRIGHT_DEV_SERVER=1` only when debugging against Vite.
- When optimizing E2E runtime, measure the default local command separately from CI and improve both paths.
- Lint/format is oxlint + oxfmt (`just lint`, `just format`), not ESLint/Prettier. Warnings are denied in CI.
- Toolchain: Node 24.x only (`engines` pins `>=24 <25`), pnpm 11.12.0 via the `packageManager` field, and just 1.58.0.

## Load-bearing rules

- **Server functions** (`src/server/fns.ts`): wrap reads in `rpc()` and mutations in `mutationRpc()` (or the narrower `workspaceMutation()`) — thrown `Response` objects otherwise reach the client as a _successful_ result, and mutations need the origin check before any state access. CSRF protection is enforced by these wrappers, not middleware. See the `adding-server-functions` skill.
- **Authorization lives in server functions**, not routes. Route `beforeLoad`/`useEffect` redirects are UX only.
- **Workspace isolation is absolute**: every tenant table carries `workspace_id` with a composite FK to its parent; every `DrizzleRepository` (`src/db/repository.ts`) method filters via the scoped repository (`scoped(workspaceId)`). New tenant tables and queries must follow suit — there is no bypass path.
- **Client queries**: `queryOptions` factories live in `src/client/queries.ts`, never inline. Workspace-scoped query keys must include `workspaceSlug` or data leaks across workspace switches. Invalidation is blanket via the workspace realtime channel — no bespoke invalidation needed.
- **`AppEvent`** (`src/core/types.ts`) is a closed union treated as a public API: additions are fine, renames/removals are breaking. Server-side state changes publish one, and mutations go through `STLQuestService`, not the repository.
- **Settings, not env vars**: product configuration goes in the `settings` (workspace) or `deployment_settings` (global) tables. Env vars are reserved for filesystem paths, operational controls, recovery, and managed-deployment overrides. See the `adding-a-setting` skill.
- **Telemetry stays useful and anonymous**: when adding or changing a meaningful workflow, consider whether a success event would answer a concrete product-health question. Capture only the minimum useful properties after success, prefer server-side capture in `STLQuestService`, and update `docs/telemetry.md` plus tests. Random internal IDs, roles, categorical state, and counts are allowed; never send names, emails, user-provided content, filenames, raw URLs, or secrets. Do not add events merely for coverage.
- **CSP is a hardcoded string in `vite.config.ts`** (under `nitro.routeRules`). Any new external image/script/connect source (OAuth avatar CDNs, telemetry hosts) requires editing it — easy to miss.
- **`AssetStore` has a behavioral contract**: `src/adapters/storeContract.test.ts` runs the same suite against the local and S3 stores (S3 gated on `MINIO_TEST_*` env vars) — semantic changes must extend it so both stay equivalent. Crash recovery replays the operation journal (`STLQuestService.resumeOperation`); a new operation kind must extend that state machine and its recovery tests.
- **Asset migrations are permanent**: stored-model or provider-folder changes use a new numbered file in `src/server/assetMigrations/` and append it to the registry. Never edit, reorder, rename, or remove a released asset migration; skipped releases must run every missing migration in order.
- **The asset worker is bundled separately**: `pnpm build` runs `src/server/assets/worker.ts` through its own esbuild pass (not the Vite/Nitro bundle) to `assets-worker.mjs`. New imports there must survive standalone bundling; tests run the queue inline (`process.env.VITEST`), so worker-only breakage won't show in unit tests.
- **Test-mode branches live in production code** on purpose: `NODE_ENV === 'test'` auto-creates a test workspace in the repository, `VITEST` disables worker threads. Don't remove them as dead code, and keep them in mind when touching those paths.
- **`src/core` stays isomorphic** — no IO, no framework imports. Nothing enforces this mechanically; you are the enforcement.
- Validate URLs by parsed hostname (`new URL(...).hostname` with boundary checks), never substring `includes()` — CodeQL runs on every PR and flags this.

## Design and refactoring

- Put each business rule in its lowest isomorphic layer. Limits, normalization, validation, asset-key construction, and state transitions belong in `src/core`; React, schemas, services, repositories, and adapters consume them rather than restating them.
- Keep route files and page/pane components as coordinators. Extract a section when it owns a cohesive workflow or state boundary and can expose a small domain-shaped interface. Do not split a file merely because it is long or replace local code with a large prop contract.
- Extract pure derivation before extracting rendered components. Models, payload builders, reconciliation, indexing, and validation are cheaper to test and reuse than framework-aware abstractions.
- Share lifecycle mechanics across sibling adapters only when the semantics match. Keep provider-specific authentication, retryability, error wording, and recovery behavior explicit; use a base default with overrides when differences are intentional.
- Prefer one narrow helper at the existing architectural boundary over parallel helpers in client, server, and worker code. If code is shared across runtimes, place it in `src/core` and verify every bundle that imports it, including the standalone asset worker.
- Preserve security and tenancy in the abstraction. Shared repository helpers must remain transaction-aware and workspace-scoped; shared server wrappers must retain authorization and mutation-origin checks.
- Reject cosmetic abstractions. A refactor should remove duplicated policy, reduce the files needed for a common change, isolate a cohesive responsibility, or make behavior directly testable. Moving lines or inventing a generic component without one of those outcomes is not an improvement.
- When adding a new provider, request field, settings workflow, or account action, search the existing registries, domain policies, form models, query utilities, and adapter bases first. Extend the established source of truth instead of adding another conditional or literal.
- Refactors are incremental: keep behavior unchanged, add focused regression coverage at the extracted boundary, and visually inspect affected rendered states. Avoid repo-wide cleanup batches that mix unrelated behavior changes.

## Co-change patterns

- Schema change → `changing-the-database` skill (generate migrations, never edit applied ones).
- Anything an operator configures (env vars, volumes, ports, upload formats) → `shipping-deploy-config` skill (README, `.env.example`, docker-compose, TrueNAS, Unraid all move together).
- TrueNAS and Unraid are self-hosted packages. Never expose hosted-service-only configuration in either installer.
- Features extend the e2e journey spec and add colocated `*.test.ts`; bug fixes carry a regression test in the same PR.

## Changesets and releases

- Run `pnpm changeset` for any change to released application behavior: one imperative, user-visible sentence (it becomes the CHANGELOG verbatim, often with a "so that" clause), `minor` for new capability, `patch` for fixes. Skip for docs/tests/refactors/tooling only.
- Merging a changeset to `main` releases immediately: version bump, tag, GitHub Release, and container publish (`latest`, `vX.Y.Z`, `sha-…`). There is no release PR, so don't merge a changeset you're not ready to ship.
- `deploy/truenas/stlquest/app.yaml`'s version is synced by `scripts/syncReleaseVersion.ts` during release — never bump it by hand.

## Pull requests

- Titles are conventional commits with product-surface scopes (not directories): `planner`, `board`, `queue`, `auth`, `storage`, `admin`, `viewer`, `upload`, `workspaces`, `router`, `csp`, `ci`, `deps`.
- The body follows `.github/pull_request_template.md`: Risk is graded (`Low.`/`Medium.`/`High.`) with an explicit rollback path; Verification lists only commands actually run, with result counts (e.g. `just check` (297 passed, 4 skipped)); inapplicable checklist items are ticked with `(N/A, reason)`.
- Never commit PR screenshots into the repo (a `docs/pr/` folder had to be cleaned up once); attach them to the PR instead.

## Product boundary

Self-hosted request intake and queue management only. Payments, shipping, slicing, printer control, marketplaces, and general-purpose automation stay out of the core application.
