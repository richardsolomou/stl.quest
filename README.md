<div align="center">
  <img src="public/favicon.svg" width="80" alt="PrintHub logo" />

# PrintHub

A private, self-hosted 3D-print production queue for resin and filament printers.

Accept STL requests, plan build plates across mixed printer fleets, and track every copy through **Queue → Printing → Finishing → Ready**. No vendor cloud or printer account is required, and files stay on storage you control.

<img src="docs/media/printhub-demo.gif" alt="PrintHub tour showing the request board, interactive STL viewer, and plate planner" width="1200" />
</div>

## What it does ✨

- Accepts private STL requests with quantities, notes, source links, and requester accounts.
- Lets requesters reorder and withdraw their own queued work without changing anyone else's priority.
- Tracks individual copies through printing, finishing, and completion.
- Supports resin and filament printers together in one installation.
- Lets requesters choose resin or filament while the planner automatically assigns each copy to a compatible printer.
- Checks model fit against configured compatible printers and highlights models that fit none.
- Estimates material using print-type-appropriate units with explicit assumptions.
- Filters the backlog and balances outstanding models across compatible resin and filament build plates.
- Exports geometry and plate layouts as 3MF files ready to open and finish configuring in a slicer.
- Generates thumbnails and lightweight browser previews inside your installation.
- Supports local folders or S3-compatible storage.
- Sends anonymous usage telemetry by default without model or request data and supports opting out at any time.
- Includes accounts, invites, optional Google or Discord login, optional authenticator-app two-factor authentication, SMTP, automatic migrations, backups, and health checks.

### Material estimates and plate output

- **Resin:** estimates are solid model volume in milliliters. Supports, drainage losses, failed prints, and other waste are excluded.
- **Filament:** estimates are 100%-solid equivalents in grams, calculated from the configured material density. Infill, walls, supports, brims, rafts, purge, and other slicer settings are excluded.
- **3MF export:** generated files contain model geometry and the planned layout. Open them in a print-type-appropriate slicer to choose orientation details, supports, adhesion, infill, material, and printer settings before printing.

## Why self-hosted only

PrintHub is designed for print shops, labs, and makerspaces that do not want customer models copied into another vendor's cloud. The application, database, files, model analysis, planner state, previews, and production history remain in your installation. S3-compatible storage is optional and uses credentials you configure.

PrintHub deliberately does not provide a public model gallery, marketplace, hosted file library, printer-vendor account, or mandatory remote service.

## Run it 🚀

```sh
docker run -d --name printhub \
  --user "$(id -u):$(id -g)" \
  --read-only --tmpfs /tmp:size=256m,mode=1777 \
  -p 3010:3000 \
  -v /path/to/appdata:/data \
  -v /path/to/prints:/prints \
  ghcr.io/richardsolomou/printhub:latest
```

Open `http://localhost:3010`. The first account created becomes the admin.

Keep `/data` on a local filesystem. SQLite WAL databases should not be placed on NFS, SMB, or CIFS.

### Other installs

- **Docker Compose:** copy `docker-compose.yml` and `.env.example`, set the host paths, then run `docker compose up -d`.
- **TrueNAS SCALE / HexOS:** create a Custom App, mount `/data` and `/prints`, and expose container port `3000`.
- **Unraid:** use [`deploy/unraid/printhub.xml`](deploy/unraid/printhub.xml).

## Configuration ⚙️

Most settings are managed in the admin UI.

| Variable     | Default   | Purpose                                                          |
| ------------ | --------- | ---------------------------------------------------------------- |
| `DATA_DIR`   | `/data`   | Database, migration backups, upload staging, and encrypted keys. |
| `PRINTS_DIR` | `/prints` | Default local model storage used before storage is configured.   |

When using a custom domain behind a reverse proxy, set `BETTER_AUTH_URL` to the public origin and include it in `BETTER_AUTH_TRUSTED_ORIGINS`. Forward the original host and protocol, and allow request bodies of at least 74 MB.

See `.env.example` for managed authentication and SMTP overrides.

## Storage and backups

Uploads use resumable 64 MB chunks and support STL files up to 1 GB. Finished files remain ordinary files in local or S3-compatible storage.

Admins can migrate storage from Settings → Storage, including local-folder moves and transfers to or between S3-compatible providers. Guided presets cover Amazon S3, Backblaze B2, Cloudflare R2, DigitalOcean Spaces, and Google Cloud Storage, while custom endpoints support MinIO and other compatible services. PrintHub pauses file mutations, copies and verifies referenced assets with progress reporting, switches only after verification, and leaves the source files untouched.

Back up `/data` and your model storage together before upgrading. For local storage, that means `/data` and `/prints`; for S3-compatible storage, include the bucket and prefix configured in PrintHub.

Source checkouts can also create a consistent online SQLite backup:

```sh
pnpm backup --output /path/to/printhub.sqlite
```

Drizzle owns the runtime schema, queries, transactions, and migrations. Migrations run automatically on startup, with a consistent SQLite snapshot written under `/data/backups` before the schema changes. Pre-Drizzle schema versions 18 through 21 are transferred into the Drizzle migration history once. Keep `integration-secrets.key` with backups that contain integration settings.

## Authentication

Users with password sign-in can enable authenticator-app two-factor authentication under **Settings → Account**. Setup provides one-time recovery codes, and sign-in can optionally trust a device for 30 days.

## Development

Requires Node 24.18 and pnpm 11.12+.

```sh
pnpm install
mkdir -p data-dev prints-dev
DATA_DIR=./data-dev PRINTS_DIR=./prints-dev pnpm dev
```

Open `http://localhost:3000`; the local storage default points at `./prints-dev`.

```sh
pnpm check
pnpm test:e2e:install
pnpm test:e2e
```

Schema changes live in `src/db/schema.ts`, the database connection and lifecycle live in `src/db/`, and generated migrations are committed under `drizzle/`. Generate and verify migrations with `pnpm db:generate` and `pnpm db:check`; application persistence should use Drizzle's typed query builder and `sql` template rather than direct driver queries.

### Releases

Changesets maintains the application changelog and release PR. Pull requests that change the released application add a release note with `pnpm changeset` and choose a patch, minor, or major version bump. Documentation, tests, refactors, and release tooling changes can omit a changeset when they do not affect the released application.

After changes land on `main`, Changesets automatically creates or updates a release PR. Merging it updates `package.json`, `deploy/truenas/printhub/app.yaml`, and `CHANGELOG.md`; creates the matching Git tag and GitHub Release from the changelog entry; and publishes the multi-architecture container as `latest`, the release tag such as `v0.18.0`, and an immutable `sha-…` tag. Nothing is published to npm or another package registry.

Configure a fine-grained token or GitHub App token as the `CHANGESETS_TOKEN` repository secret so release PRs trigger the normal pull-request checks. It needs read/write access to contents and pull requests. Without it, the workflow falls back to `GITHUB_TOKEN`, but GitHub does not start other workflows for pull requests created with `GITHUB_TOKEN`.

See [CONTRIBUTING.md](CONTRIBUTING.md) for contribution notes, [SECURITY.md](SECURITY.md) for vulnerability reports, and [GitHub Issues](https://github.com/richardsolomou/printhub/issues) for planned work.

## License

[MIT](LICENSE)
