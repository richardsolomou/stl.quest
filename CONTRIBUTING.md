# Contributing to PrintHub

Thanks for helping! PrintHub aims to stay a small, hackable codebase. Check existing issues before starting substantial work, and open one first when the scope or product direction needs discussion. Conventions for coding agents live in [AGENTS.md](AGENTS.md).

## Development setup

Requirements: Node 24.x and pnpm 11.12.0.

```sh
pnpm install
mkdir -p data-dev prints-dev
DATA_DIR=./data-dev PRINTS_DIR=./prints-dev BETTER_AUTH_URL=http://localhost:3000 pnpm dev
```

The first visitor to `http://localhost:3000` claims the admin account.

## Checks

Run the complete local check suite with:

```sh
pnpm check
pnpm test:e2e
```

`pnpm check` runs formatting, linting, migration validation, printer-catalog validation, the production build, type checking, unit tests, and the backup CLI smoke test. The build runs before type checking because it generates `src/routeTree.gen.ts`. `pnpm test:e2e` builds and tests the production server; use `pnpm test:e2e:run` for fast reruns against the current build, or set `PLAYWRIGHT_DEV_SERVER=1` only when debugging against Vite. Install Chromium once with `pnpm test:e2e:install` before running the end-to-end suite.

Run `pnpm test:e2e:screenshots` when you need the manual inspection screenshots under `test-results/`, or `pnpm test:e2e:trace` when debugging with a Playwright trace; regular local runs skip both.

The storage contract tests run against a real S3 endpoint when `MINIO_TEST_URL`, `MINIO_TEST_ACCESS_KEY`, and `MINIO_TEST_SECRET_KEY` are set; they skip otherwise. CI runs this contract weekly and on manual workflow dispatch against the pinned MinIO image.

Smoke-test the online backup command against disposable data with `DATA_DIR=/tmp/printhub-test pnpm backup --output /tmp/printhub-backup.sqlite`. Its CLI help is covered by `pnpm check:cli`.

The predefined printer catalog is generated from pinned third-party sources and exact official manufacturer pages. Run `pnpm catalog:sync` to reproduce the committed snapshot, `pnpm catalog:update-images` to refresh pinned image sources and live manufacturer data, or `pnpm catalog:update` to advance GitHub source revisions and regenerate everything. `pnpm catalog:check` validates the committed snapshot, provenance, and required licenses without network access.

## Release notes

Run `pnpm changeset` in pull requests that change the released application. Choose the appropriate patch, minor, or major bump and write a concise user-visible summary. Changes that only affect documentation, tests, refactoring, or release tooling do not need a changeset unless they affect application behavior.

When changesets reach `main`, CI updates `package.json`, `deploy/truenas/printhub/app.yaml`, and `CHANGELOG.md`; creates the matching Git tag and GitHub Release; and publishes the multi-architecture container as `latest`, the release tag, and an immutable `sha-…` tag. PrintHub is not published to npm or another package registry.

## Database changes

The Drizzle schema, repository, database connection, backup support, and migration lifecycle live in `src/db/`. Schema tables are grouped by domain under `src/db/schema/`, while reusable selections and row mappers live under `src/db/repository/`. Application persistence should use Drizzle's typed query builder and `sql` template rather than direct driver queries.

After changing the schema, generate and verify a new migration:

```sh
pnpm db:generate
pnpm db:check
```

Commit the generated files under `drizzle/`. Never edit a migration that may already have been applied.

## Layout

- `src/core` — isomorphic domain code: types, the request service, workflow, asset keys, access roles, and pure mesh code (`mesh/`: STL codec, software rasterizer) shared by server and browser. No IO, no framework imports.
- `src/adapters` — implementations of external core boundaries: local/S3 asset stores, authentication configuration, outbound email, upload staging, event bus, and telemetry.
- `src/db` — Drizzle repository, domain-grouped schema, database connection, backups, and migration lifecycle. Generated migrations live under `drizzle/`.
- `src/server` — composition root (`app.ts`), better-auth config, server functions, HTTP guards, and the asset pipeline (`assets/`: preview decimation and indexed mesh compression, PNG encoding, the generation queue, and the worker_thread entry that `pnpm build` bundles next to the server).
- `src/client` — React components, hooks, and client utilities.
- `src/routes` — TanStack Start file routes; keep them thin.

## Conventions

- Keep PrintHub focused on self-hosted request intake and queue management. Payments, shipping, slicing, printer control, and general-purpose automation belong outside the core application.
- Database changes use generated Drizzle migrations; never edit a migration that may already have been applied.
- Product configuration belongs in **Settings** and the `settings` table. Environment variables are reserved for filesystem paths, operational controls, recovery, and read-only managed-deployment overrides.
- Server-side state changes publish a typed `AppEvent` (see `src/core/types.ts`); additions are fine, renames are breaking.
- New functionality comes with tests. Test behavior through the public surface (service methods, HTTP routes), not implementation details.
- Commit messages: present-tense imperative summary line, body explaining the why.
- Pull request titles use conventional commits with a product-surface scope (`fix(planner): …`); squash merges make them the commit history.
