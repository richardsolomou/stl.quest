# Contributing to STL Quest

Thanks for helping with STL Quest. We aim to keep the codebase small and easy to understand. Before starting a substantial change, check for an existing issue. Open an issue first if the scope or product direction needs discussion. Coding-agent instructions live in [AGENTS.md](AGENTS.md).

## Development setup

Install Node 24.x, pnpm 11.15.0, and just 1.58.0, then run:

```sh
just install
```

Start the application and its realtime service with `just dev`.

Open `http://localhost:3000`. The first account created becomes the administrator.

## Checks

Run the complete local check suite with:

```sh
just check
just e2e
```

`just check` runs the formatter, linter, database migration checks, printer catalog and Unraid metadata checks, production build, type checker, unit tests, and a quick backup command test. The build comes before type checking because it generates `src/routeTree.gen.ts`.

`just e2e` builds the production server and runs the end-to-end tests. Install Chromium once with `just e2e-install`. For faster reruns against an existing build, use `just e2e-run`. Set `PLAYWRIGHT_DEV_SERVER=1` only when debugging against Vite.

Run `just e2e-screenshots` when you need the manual inspection screenshots under `test-results/`, or `just e2e-trace` when debugging with a Playwright trace; regular local runs skip both.

Pull requests from repository branches receive a disposable, seeded preview on the team's Dokploy server after the preview workflow is configured. See [Pull request previews](docs/development/pr-previews.md) for lifecycle, access, and server setup.

The storage contract tests run against a real S3 endpoint when `MINIO_TEST_URL`, `MINIO_TEST_ACCESS_KEY`, and `MINIO_TEST_SECRET_KEY` are set; they skip otherwise. CI runs this contract weekly and on manual workflow dispatch against the pinned MinIO image.

Test the online backup command with disposable data by running `DATA_DIR=/tmp/stlquest-test just backup --output /tmp/stlquest-backup.sqlite`. `just check` checks the command-line help.

See the [printer catalog guide](printer-catalog/README.md) before changing printer data or images.

## Release notes

Run `pnpm changeset` in pull requests that change the released application. Choose the appropriate patch, minor, or major bump and write a concise user-visible summary. Changes that only affect documentation, tests, refactoring, or release tooling do not need a changeset unless they affect application behavior.

When changesets reach `main`, CI updates `package.json`, `deploy/truenas/stlquest/app.yaml`, and `CHANGELOG.md`; creates the matching Git tag and GitHub Release; and publishes the multi-architecture container as `latest`, the release tag, and an immutable `sha-…` tag. STL Quest is not published to npm or another package registry.

## Development guides

- [Running STL Quest locally](docs/development/running-locally.md)
- [End-to-end testing](docs/development/e2e-testing.md)
- [Database changes](docs/development/database-changes.md)
- [Server functions](docs/development/server-functions.md)
- [Adding a setting](docs/development/settings.md)
- [Changing deployment configuration](docs/development/deployment-configuration.md)
- [Pull request previews](docs/development/pr-previews.md)

## Layout

- `src/core` — isomorphic domain code: types, the request service, workflow, asset keys, access roles, and pure mesh code (`mesh/`: STL codec, software rasterizer) shared by server and browser. No IO, no framework imports.
- `src/adapters` — implementations of external core boundaries: local/S3 asset stores, authentication configuration, outbound email, upload staging, event bus, and telemetry.
- `src/db` — Drizzle repository, SQLite and PostgreSQL schemas, database connection, backups, and migration lifecycle. Generated migrations live under `drizzle/` and `drizzle-postgres/`.
- `src/server` — application setup (`app.ts`), Better Auth configuration, server functions, HTTP guards, and model processing (`assets/`: optimized previews, compressed meshes, PNG encoding, the generation queue, and the worker thread that `pnpm build` bundles next to the server).
- `src/client` — React components, hooks, and client utilities.
- `src/routes` — TanStack Start file routes; keep them thin.

## Conventions

- Keep STL Quest focused on self-hosted request intake and queue management. Payments, shipping, slicing, printer control, and general-purpose automation belong outside the core application.
- Database changes use generated Drizzle migrations; never edit a migration that may already have been applied.
- Product configuration belongs in **Settings** and the `settings` table. Environment variables are reserved for filesystem paths, operational controls, recovery, and read-only managed-deployment overrides.
- Server-side state changes publish a typed `AppEvent` (see `src/core/types.ts`); additions are fine, renames are breaking.
- New functionality comes with tests. Test behavior through the public surface (service methods, HTTP routes), not implementation details.
