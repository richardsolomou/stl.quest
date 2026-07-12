# Contributing to PrintHub

Thanks for helping! PrintHub aims to stay a small, hackable codebase — read [VISION.md](VISION.md) first; it explains what belongs in core and what deliberately stays out.

## Development setup

Requirements: Node 22+ and pnpm 10.33+.

```sh
pnpm install
DATA_DIR=./data-dev pnpm dev
```

The first visitor to `http://localhost:3000` claims the operator account. Point **Settings → Storage** at a writable folder like `$PWD/prints-dev`.

## Checks

Every pull request must pass:

```sh
pnpm build      # also regenerates src/routeTree.gen.ts, which typecheck needs
pnpm typecheck
pnpm test
```

The storage contract tests run against a real S3 endpoint when `MINIO_TEST_URL` is set (for example a local MinIO container); they skip otherwise.

## Layout

- `src/core` — isomorphic domain code: types, the request service, workflow, asset keys, access roles, and pure mesh code (`mesh/`: STL codec, software rasterizer) shared by server and browser. No IO, no framework imports.
- `src/adapters` — implementations of the core boundaries: SQLite repository (+ numbered migrations), local/S3 asset stores, upload staging, event bus, telemetry.
- `src/server` — composition root (`app.ts`), better-auth config, server functions, HTTP guards, and the asset pipeline (`assets/`: preview decimation, PNG encoding, the generation queue, and the worker_thread entry that `pnpm build` bundles next to the server).
- `src/client` — React components, hooks, and client utilities.
- `src/routes` — TanStack Start file routes; keep them thin.

## Conventions

- Database changes are new numbered files in `src/adapters/migrations/`; never edit an applied migration.
- Anything an operator configures belongs in **Settings** (the `settings` table), not in environment variables. `DATA_DIR` is the only env var.
- Server-side state changes publish a typed `AppEvent` (see `src/core/types.ts`); additions are fine, renames are breaking.
- New functionality comes with tests. Test behavior through the public surface (service methods, HTTP routes), not implementation details.
- Commit messages: present-tense imperative summary line, body explaining the why.
