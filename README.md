<div align="center">
  <img src="public/favicon.svg" width="80" alt="PrintHub logo" />

# PrintHub

A self-hosted queue for 3D print requests.

Upload STL files, track copies across **To Do → In Progress → Done**, preview models, and plan printer plates. Files stay on storage you control.

<img src="docs/media/printhub-demo.gif" alt="PrintHub tour showing the request board, interactive STL viewer, and plate planner" width="1200" />
</div>

## What it does ✨

- Accepts STL uploads with quantities, notes, source links, and requester names.
- Tracks individual copies through a shared or private Kanban board.
- Generates thumbnails and lightweight browser previews on the server.
- Estimates solid resin volume per model and across each workflow column.
- Includes a generated catalog of FDM and SLA printers for setup and request assignment.
- Packs outstanding models across configured printer build plates.
- Supports local folders or S3-compatible storage.
- Includes accounts, invites, optional Google or Discord login, SMTP, backups, health checks, and metrics.

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

Refresh the bundled printer catalog from its pinned Bambu Studio, Cura, and UVtools revisions with `pnpm catalog:update`. Review `THIRD_PARTY_NOTICES.md` when changing any source.

### Releases

Release Please maintains a release PR from conventional commit titles. Use `fix:` for a patch release, `feat:` for a minor release, and append `!` for a breaking release. Other prefixes such as `chore:`, `docs:`, and `ci:` do not trigger a release by themselves.

Merging the release PR updates `package.json`, `deploy/truenas/printhub/app.yaml`, and `CHANGELOG.md`; creates the matching Git tag and GitHub Release; and publishes the multi-architecture container as `latest`, the release tag such as `v0.17.0`, and an immutable `sha-…` tag.

Configure a fine-grained token or GitHub App token as the `RELEASE_PLEASE_TOKEN` repository secret so release PRs trigger the normal pull-request checks. It needs read/write access to contents and pull requests. Without it, the workflow falls back to `GITHUB_TOKEN`, but GitHub will not start other workflows for the automated release PR.

See [CONTRIBUTING.md](CONTRIBUTING.md) for contribution notes, [SECURITY.md](SECURITY.md) for vulnerability reports, and [GitHub Issues](https://github.com/richardsolomou/printhub/issues) for planned work.

## License

[GNU Affero General Public License v3.0](LICENSE)
