<div align="center">
  <img src="public/favicon.svg" width="80" alt="PrintHub logo" />

# PrintHub

A private, self-hosted 3D-print production queue for resin and filament printers.

Accept STL requests, plan build plates across mixed printer fleets, and track every copy through **Queue → Printing → Finishing → Ready**. No vendor cloud or printer account is required, and files stay on storage you control.

<img src="docs/media/printhub-demo.gif" alt="PrintHub tour showing the request board, interactive STL viewer, and plate planner" width="1200" />
</div>

## What it does ✨

- Accepts private STL requests with quantities, notes, source links, and requester accounts.
- Tracks individual copies through printing, finishing, and completion.
- Supports resin and filament printers together in one installation.
- Assigns requests directly to a printer, or keeps them in an unassigned same-print-type pool as the fleet changes.
- Checks model fit against configured compatible printers and highlights models that fit none.
- Estimates material using print-type-appropriate units with explicit assumptions.
- Filters the backlog and plans outstanding models across resin and filament build plates.
- Exports geometry and plate layouts as 3MF files ready to open and finish configuring in a slicer.
- Generates thumbnails and lightweight browser previews inside your installation.
- Supports local folders or S3-compatible storage.
- Sends anonymous usage telemetry by default without model or request data and supports opting out at any time.
- Includes accounts, invites, optional Google or Discord login, SMTP, backups, health checks, and metrics.

### Material estimates and plate output

- **Resin:** estimates are solid model volume in milliliters. Supports, drainage losses, failed prints, and other waste are excluded.
- **Filament:** estimates are 100%-solid equivalents in grams and filament length, calculated from the configured material density and filament diameter. Infill, walls, supports, brims, rafts, purge, and other slicer settings are excluded.
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

| Variable                | Default   | Purpose                                        |
| ----------------------- | --------- | ---------------------------------------------- |
| `DATA_DIR`              | `/data`   | Database, upload staging, and integration key. |
| `PRINTS_DIR`            | `/prints` | Default local model storage.                   |
| `ASSET_JOB_CONCURRENCY` | `1`       | Concurrent preview and analysis jobs.          |
| `METRICS_TOKEN`         | —         | Optional bearer token for `/api/metrics`.      |

When using a custom domain behind a reverse proxy, set `BETTER_AUTH_URL` to the public origin and include it in `BETTER_AUTH_TRUSTED_ORIGINS`. Forward the original host and protocol, and allow request bodies of at least 74 MB.

See `.env.example` for managed authentication and SMTP overrides.

## Storage and backups

Uploads use resumable 64 MB chunks and support STL files up to 1 GB. Finished files remain ordinary files in local or S3-compatible storage.

Back up `/data` and `/prints` together before upgrading:

```sh
pnpm backup --output /path/to/printhub.sqlite
```

Database migrations run automatically on startup. Keep `integration-secrets.key` with database backups that contain integration settings.

## Development

Requires Node 24.18 and pnpm 11.12+.

```sh
pnpm install
DATA_DIR=./data-dev pnpm dev
```

Point **Settings → Storage** at a writable directory such as `$PWD/prints-dev`.

```sh
pnpm check
pnpm test:e2e
```

### Releases

Release Please maintains a release PR from conventional commit titles. Use `fix:` for a patch release, `feat:` for a minor release, and append `!` for a breaking release. Other prefixes such as `chore:`, `docs:`, and `ci:` do not trigger a release by themselves.

Merging the release PR updates `package.json`, `deploy/truenas/printhub/app.yaml`, and `CHANGELOG.md`; creates the matching Git tag and GitHub Release; and publishes the multi-architecture container as `latest`, the release tag such as `v0.17.0`, and an immutable `sha-…` tag.

Configure a fine-grained token or GitHub App token as the `RELEASE_PLEASE_TOKEN` repository secret so release PRs trigger the normal pull-request checks. It needs read/write access to contents and pull requests. Without it, the workflow falls back to `GITHUB_TOKEN`, but GitHub will not start other workflows for the automated release PR.

See [CONTRIBUTING.md](CONTRIBUTING.md) for contribution notes, [SECURITY.md](SECURITY.md) for vulnerability reports, and [GitHub Issues](https://github.com/richardsolomou/printhub/issues) for planned work.

## License

[MIT](LICENSE)
