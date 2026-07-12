# Contributing to PrintHub

Thanks for helping! PrintHub aims to stay a small, hackable codebase. Check existing issues before starting substantial work, and open one first when the scope or product direction needs discussion.

## Development setup

Requirements: Node 24.18 and pnpm 11.12+.

```sh
pnpm install
DATA_DIR=./data-dev pnpm dev
```

The first visitor to `http://localhost:3000` claims the admin account. Point **Settings → Storage** at a writable folder like `$PWD/prints-dev`.

## Checks

Run the complete local check suite with:

```sh
pnpm check
pnpm test:e2e
```

`pnpm check` runs formatting, linting, the production build, type checking, unit tests, and CLI smoke tests. The build runs before type checking because it generates `src/routeTree.gen.ts`. Install Chromium once with `pnpm test:e2e:install` before running the end-to-end suite.

The storage contract tests run against a real S3 endpoint when `MINIO_TEST_URL`, `MINIO_TEST_ACCESS_KEY`, and `MINIO_TEST_SECRET_KEY` are set; they skip otherwise. CI runs this contract weekly and on manual workflow dispatch against the pinned MinIO image.

Smoke-test the online backup command against disposable data with `DATA_DIR=/tmp/printhub-test pnpm backup --output /tmp/printhub-backup.sqlite`. CLI help for backup and migration utilities is covered by `pnpm check:cli`.

## Layout

- `src/core` — isomorphic domain code: types, the request service, workflow, asset keys, access roles, and pure mesh code (`mesh/`: STL codec, software rasterizer) shared by server and browser. No IO, no framework imports.
- `src/adapters` — implementations of the core boundaries: SQLite repository (+ numbered migrations), local/S3 asset stores, authentication configuration, outbound email, upload staging, event bus, telemetry.
- `src/server` — composition root (`app.ts`), better-auth config, server functions, HTTP guards, and the asset pipeline (`assets/`: preview decimation, PNG encoding, the generation queue, and the worker_thread entry that `pnpm build` bundles next to the server).
- `src/client` — React components, hooks, and client utilities.
- `src/routes` — TanStack Start file routes; keep them thin.

## Conventions

- Keep PrintHub focused on self-hosted request intake and queue management. Payments, shipping, slicing, printer control, and general-purpose automation belong outside the core application.
- Database changes are new numbered files in `src/adapters/migrations/`; never edit an applied migration.
- Product configuration belongs in **Settings** and the `settings` table. Environment variables are reserved for filesystem paths, operational controls, recovery, and read-only managed-deployment overrides.
- Server-side state changes publish a typed `AppEvent` (see `src/core/types.ts`); additions are fine, renames are breaking.
- New functionality comes with tests. Test behavior through the public surface (service methods, HTTP routes), not implementation details.
- Commit messages: present-tense imperative summary line, body explaining the why.
