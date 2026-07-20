<div align="center">
  <img src="public/favicon.svg" width="80" alt="PrintHub logo" />

# PrintHub

**A private 3D-print production queue for resin and filament printers, available self-hosted or as a managed service.**

[![Latest release](https://img.shields.io/github/v/release/richardsolomou/printhub)](https://github.com/richardsolomou/printhub/releases) [![Build](https://img.shields.io/github/actions/workflow/status/richardsolomou/printhub/docker.yml?branch=main)](https://github.com/richardsolomou/printhub/actions/workflows/docker.yml) [![License](https://img.shields.io/github/license/richardsolomou/printhub)](LICENSE)

Collect STL requests, order work fairly, assign compatible models across resin and filament printers, and track every copy from **Queue → Up next → Printing → Finishing → Ready**—whether you print for friends, run a side gig, or manage a production business.

<img src="docs/media/printhub-demo.gif" alt="PrintHub tour showing the request board and interactive STL viewer" width="1200" />
</div>

## Who is it for? 👋

PrintHub is for anyone who needs a better way to organize incoming print requests:

- **Hobbyists** printing for friends who want to keep models, quantities, and progress out of chat threads and their own heads.
- **Print farms and businesses** managing more printers, more customers, and a growing production backlog.

It replaces spreadsheets, messages, and handwritten queues with one clear view of what was requested, what should run next, which printer is doing the work, and what is ready to collect.

## How it works ✨

1. **You or your requesters upload models** with quantities, notes, and a preferred print type.
2. **You choose a queue order** such as fair-by-requester, oldest first, or highest quantity.
3. **PrintHub assigns compatible work automatically**, or an operator chooses a specific printer.
4. **Your slicer prepares the build** with its own orientation, arrangement, and support tools.
5. **Each copy is tracked** through printing, finishing, and collection.

Along the way, PrintHub provides:

- A private request queue with accounts, invites, and optional social login and two-factor authentication.
- Interactive STL previews, thumbnails, queue sorting, backlog filtering, and keyboard or drag-and-drop board controls.
- Mixed resin and filament printer fleets with dimension-aware automatic assignment.
- Local-folder, S3-compatible, Dropbox, Google Drive, or OneDrive model storage, with guided storage migration.
- Fair queue ordering, manual requester priorities, and withdrawal controls.
- Automatic database migrations, backups, health checks, and optional SMTP notifications.

## Self-hosted or managed 🔒

PrintHub can run as a single self-hosted appliance or as a multi-tenant hosted service. Every account gets a private workspace with its own board, printers, members, settings, and storage configuration, and users can also join other workspaces by invitation.

Self-hosted installations keep the application, database, files, previews, and production history under the operator's control. Hosted customer workspaces must choose S3-compatible or connected cloud storage so tenants cannot persist models on the application host, while workspaces created by a super admin may still use local folders. Every local folder, cloud folder, or S3 prefix receives an enforced workspace namespace. PrintHub does not provide slicing, printer control, a public model gallery, marketplace, printer-vendor account, or mandatory hosted file library.

Anonymous usage telemetry is enabled by default, never includes model or request data, and can be disabled at any time — the [telemetry page](docs/telemetry.md) lists exactly what is sent.

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

Workspace Settings manage printers, members, board behavior, workspace deletion, and workspace storage. The separate deployment Admin area manages all user accounts, authentication providers, SMTP delivery, telemetry, and diagnostics.

Environment variables, reverse proxy setup, health checks, backups, and upgrades are covered in the [deployment guide](docs/deployment.md).

## Storage and backups 💾

PrintHub supports ordinary local folders, remote WebDAV folders, connected Dropbox, Google Drive, and OneDrive accounts, and S3-compatible services including Amazon S3, Backblaze B2, Cloudflare R2, DigitalOcean Spaces, Google Cloud Storage, and MinIO. Hosted users can expose a folder on their own machine or NAS through Cloudflare Tunnel or Tailscale Funnel, keeping model files and previews as ordinary files on hardware they control. Settings → Storage guides setup and migrates referenced files with progress reporting before switching providers; the [storage guide](docs/storage.md) covers provider and tunnel setup.

Back up `/data` and the active local or cloud model store together before upgrading — the [deployment guide](docs/deployment.md) covers consistent backups, encryption keys, restores, and upgrade behavior.

Your slicer remains the source of truth for orientation, arrangement, supports, infill, adhesion, waste, and material use.

## Development 🛠️

Requires Node 24.x and pnpm 11.12.0. Setup, checks, and release guidance live in [CONTRIBUTING.md](CONTRIBUTING.md); see [SECURITY.md](SECURITY.md) for vulnerability reports and [GitHub Issues](https://github.com/richardsolomou/printhub/issues) for planned work.

## License

[MIT](LICENSE)
