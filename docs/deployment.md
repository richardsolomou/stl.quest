# Deployment guide

Operational reference for self-hosting PrintHub. For a quick start, see the [README](../README.md).

## Environment variables

Product configuration lives in the app (Workspace Settings and the Admin area). Environment variables cover filesystem paths, operational controls, and recovery — see `.env.example` for a paste-ready template.

| Variable                                                              | Default   | Purpose                                                                                                       |
| --------------------------------------------------------------------- | --------- | ------------------------------------------------------------------------------------------------------------- |
| `DATA_DIR`                                                            | `/data`   | Database, migration backups, upload staging, and encrypted keys.                                              |
| `PRINTS_DIR`                                                          | `/prints` | Default local storage folder shown during setup.                                                              |
| `PRINTHUB_HOSTED`                                                     | `false`   | Enables hosted signup semantics without assigning the first account deployment-wide admin.                    |
| `BETTER_AUTH_URL`                                                     | —         | Public origin when running behind a reverse proxy or custom domain.                                           |
| `BETTER_AUTH_TRUSTED_ORIGINS`                                         | —         | Additional trusted origins, comma-separated.                                                                  |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASSWORD` | —         | Setting `SMTP_HOST` switches email delivery from Admin settings to the environment; the port defaults to 587. |
| `EMAIL_FROM`                                                          | —         | Sender address; required when `SMTP_HOST` is set.                                                             |
| `AUTH_PASSWORD_ENABLED`                                               | `true`    | Overrides whether password sign-in is available.                                                              |
| `AUTH_PASSWORD_RECOVERY`                                              | `false`   | Forces password sign-in on regardless of stored settings; see [Account recovery](#account-recovery).          |
| `INTEGRATIONS_ENCRYPTION_KEY`                                         | —         | Base64url-encoded 32-byte key used instead of `/data/integration-secrets.key`.                                |
| `LOG_LEVEL`                                                           | `info`    | Pino log level.                                                                                               |

## Reverse proxy

Set `BETTER_AUTH_URL` to the public origin and add it to `BETTER_AUTH_TRUSTED_ORIGINS`. Configure the proxy to preserve the original host and protocol (`Host` or `X-Forwarded-Host`, plus `X-Forwarded-Proto`) — mutations are origin-checked, so a proxy that rewrites them breaks sign-in and saves.

Model uploads are resumable tus requests sent in 32 MB chunks. Allow request bodies of at least that size (for nginx, `client_max_body_size 64m;`); the app itself caps a single upload at 1 GB. Live board updates stream over server-sent events at `/api/events`, so response buffering must be off for that path.

### Sample configurations

nginx:

```nginx
server {
  server_name printhub.example.com;
  client_max_body_size 64m;

  location / {
    proxy_pass http://127.0.0.1:3010;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-Proto $scheme;
  }

  location /api/events {
    proxy_pass http://127.0.0.1:3010;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_buffering off;
    proxy_read_timeout 1h;
  }
}
```

Caddy sets the forwarded headers, streams responses, and imposes no body limit by default:

```text
printhub.example.com {
  reverse_proxy 127.0.0.1:3010
}
```

Traefik likewise needs no body-size or buffering overrides; route to the container port:

```yaml
labels:
  - traefik.http.routers.printhub.rule=Host(`printhub.example.com`)
  - traefik.http.services.printhub.loadbalancer.server.port=3000
```

## Health checks

`GET /api/health` returns HTTP 200 with a JSON body when the database and file storage are writable, and a non-200 status otherwise. The container image already runs it as its built-in `HEALTHCHECK`; point Compose healthchecks, reverse-proxy upstream checks, or uptime monitors at the same endpoint.

## Storage and secrets

Dropbox uses scoped App folder access, Google Drive uses the limited `drive.file` scope, and OneDrive stores files in its application folder. OAuth client secrets and refresh tokens are encrypted with `/data/integration-secrets.key`; keep that key with database backups, or supply the key material via `INTEGRATIONS_ENCRYPTION_KEY` instead.

Keep `/data` on a local filesystem. SQLite WAL databases should not be placed on NFS, SMB, or CIFS.

## Backups

Back up `/data` and your model storage together before upgrading. Automatic migrations create a SQLite snapshot under `/data/backups`, but that snapshot does not replace a backup of your stored models.

For a consistent backup while the app is running, use the online backup command from a source checkout on the host (the container image does not ship it). It snapshots the live database through SQLite's backup API and copies the integration-secrets key alongside:

```sh
DATA_DIR=/path/to/appdata pnpm backup --output /path/to/backups/printhub.sqlite
```

## Restoring

1. Stop the container.
2. Replace `/data/printhub.sqlite` with the backup, and delete any leftover `printhub.sqlite-wal` and `printhub.sqlite-shm` files so stale write-ahead state is not applied to the restored database.
3. Restore the matching `integration-secrets.key` if cloud storage or integrations were configured.
4. Start the container. If the backup predates the current version, migrations run automatically on boot.

## Upgrading

Pull the new image and recreate the container. Database migrations run automatically on boot after taking the pre-migration snapshot; a failed migration aborts startup, so the previous image plus the snapshot under `/data/backups` is always the rollback path.

## Account recovery

If sign-in breaks — for example a misconfigured social provider — set `AUTH_PASSWORD_RECOVERY=true` and restart to force password sign-in on, fix the provider configuration in the Admin area, then remove the variable.
