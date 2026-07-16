<div align="center">
  <img src="public/favicon.svg" width="80" alt="PrintHub logo" />

# PrintHub

**A private 3D-print production queue for resin and filament printers, available self-hosted or as a managed service.**

Collect STL requests, plan resin and filament build plates, and track every copy from **Queue → Printing → Finishing → Ready**—whether you print for friends, run a side gig, or manage a production business.

<img src="docs/media/printhub-demo.gif" alt="PrintHub tour showing the request board, interactive STL viewer, and plate planner" width="1200" />
</div>

## Who is it for? 👋

PrintHub is for anyone who needs a better way to organize incoming print requests:

- **Hobbyists** printing for friends who want to keep models, quantities, and progress out of chat threads and their own heads.
- **Print farms and businesses** managing more printers, more customers, and a growing production backlog.

It replaces spreadsheets, messages, and handwritten queues with one clear view of what was requested, what fits, what is on a plate, and what is ready to collect.

## How it works ✨

1. **You or your requesters upload models** with quantities, notes, and a preferred print type.
2. **PrintHub checks compatibility** against your configured printers and estimates material use.
3. **You plan build plates** across the outstanding resin and filament workload.
4. **3MF layouts open in your slicer** for final orientation, supports, and print settings.
5. **Each copy is tracked** through printing, finishing, and collection.

Along the way, PrintHub provides:

- A private request queue with accounts, invites, and optional social login and two-factor authentication.
- Interactive STL previews, thumbnails, model-fit checks, and backlog filtering.
- Mixed resin and filament printer fleets in one installation.
- Local-folder or S3-compatible model storage, with guided storage migration.
- Reordering and withdrawal controls that preserve everyone else's queue priority.
- Automatic database migrations, backups, health checks, and optional SMTP notifications.

## Self-hosted or managed 🔒

PrintHub can run as a single self-hosted appliance or as a multi-tenant hosted service. Every account gets a private workspace with its own board, planner, members, settings, and storage configuration, and users can also join other workspaces by invitation.

Self-hosted installations keep the application, database, files, model analysis, planner state, previews, and production history under the operator's control. Hosted deployments manage the application while each workspace supplies its own local or S3-compatible storage. PrintHub does not provide a public model gallery, marketplace, printer-vendor account, or mandatory hosted file library.

Anonymous usage telemetry is enabled by default, never includes model or request data, and can be disabled at any time.

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

> Keep `/data` on a local filesystem. SQLite WAL databases should not be placed on NFS, SMB, or CIFS.

### Other installs

- **Docker Compose:** configure `docker-compose.yml` and `.env.example`, then run `docker compose up -d`.
- **TrueNAS SCALE / HexOS:** follow the [TrueNAS guide](deploy/truenas/README.md).
- **Unraid:** use [`deploy/unraid/printhub.xml`](deploy/unraid/printhub.xml).

## Configuration ⚙️

Most settings—including printers, materials, storage, authentication, and email—are managed in the admin UI.

| Variable          | Default   | Purpose                                                                                     |
| ----------------- | --------- | ------------------------------------------------------------------------------------------- |
| `DATA_DIR`        | `/data`   | Database, migration backups, upload staging, and encrypted keys.                            |
| `PRINTS_DIR`      | `/prints` | Base directory for workspace-local storage before a custom storage destination is selected. |
| `PRINTHUB_HOSTED` | `false`   | Enables hosted signup semantics without assigning the first account deployment-wide admin.  |

For a custom domain, set `BETTER_AUTH_URL` to the public origin, add it to `BETTER_AUTH_TRUSTED_ORIGINS`, and configure your reverse proxy to preserve the original host and protocol. See `.env.example` for authentication and SMTP overrides.

## Storage and backups 💾

PrintHub supports ordinary local folders and S3-compatible services including Amazon S3, Backblaze B2, Cloudflare R2, DigitalOcean Spaces, Google Cloud Storage, and MinIO.

Back up `/data` and your model storage together before upgrading. Automatic migrations create a SQLite snapshot under `/data/backups`, but that snapshot does not replace a backup of your stored models.

Material estimates are planning aids: resin is reported as solid model volume, while filament is reported as a 100%-solid equivalent based on material density. Your slicer remains the source of truth for supports, infill, adhesion, waste, and final material use.

## Development 🛠️

Requires Node 24.18 and pnpm 11.12+.

```sh
pnpm install
mkdir -p data-dev prints-dev
DATA_DIR=./data-dev PRINTS_DIR=./prints-dev pnpm dev
```

Open `http://localhost:3000`, then run checks with:

```sh
pnpm check
pnpm test:e2e:install
pnpm test:e2e
```

See [CONTRIBUTING.md](CONTRIBUTING.md) for development and release guidance, [SECURITY.md](SECURITY.md) for vulnerability reports, and [GitHub Issues](https://github.com/richardsolomou/printhub/issues) for planned work.

## License

[MIT](LICENSE)
