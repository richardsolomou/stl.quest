# Deployment guide

Operational reference for self-hosting STL Quest. For a quick start, see the [README](../README.md).

## Environment variables

Product configuration lives in the app (Workspace Settings and the Super Admin area). Environment variables cover filesystem paths, deployment controls, managed overrides, and recovery. When an authentication provider or SMTP is configured in both places, the environment configuration takes precedence and the Super Admin area reports it as environment-managed.

| Variable                                                              | Default   | Purpose                                                                                                                         |
| --------------------------------------------------------------------- | --------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `DATA_DIR`                                                            | `/data`   | Database, pre-migration database snapshots, upload staging, and the generated integration encryption key.                       |
| `PRINTS_DIR`                                                          | `/prints` | Default local model-storage root used until a workspace storage setting is saved.                                               |
| `STLQUEST_HOSTED`                                                     | `false`   | Enables hosted signup semantics, restricts tenant storage, and does not assign a super admin.                                   |
| `BETTER_AUTH_URL`                                                     | —         | Optional public HTTP or HTTPS origin override for reverse proxies and custom domains.                                           |
| `BETTER_AUTH_TRUSTED_ORIGINS`                                         | —         | Additional trusted origins, comma-separated.                                                                                    |
| `AUTH_PASSWORD_ENABLED`                                               | stored    | Overrides the Super Admin setting for password sign-in. Defaults to enabled when neither source has a value.                    |
| `AUTH_PASSWORD_RECOVERY`                                              | `false`   | Forces password sign-in on regardless of stored settings or `AUTH_PASSWORD_ENABLED`; see [Account recovery](#account-recovery). |
| `AUTH_GOOGLE_CLIENT_ID`, `AUTH_GOOGLE_CLIENT_SECRET`                  | —         | Google OAuth credentials. Both variables must be set together; an environment pair replaces the stored Google configuration.    |
| `AUTH_GOOGLE_ENABLED`                                                 | `true`    | Enables an environment-configured Google provider. False values are `0`, `false`, `no`, or `off`, case-insensitively.           |
| `AUTH_DISCORD_CLIENT_ID`, `AUTH_DISCORD_CLIENT_SECRET`                | —         | Discord OAuth credentials. Both variables must be set together; an environment pair replaces the stored Discord configuration.  |
| `AUTH_DISCORD_ENABLED`                                                | `true`    | Enables an environment-configured Discord provider. False values are `0`, `false`, `no`, or `off`, case-insensitively.          |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASSWORD` | —         | Setting `SMTP_HOST` replaces the Super Admin SMTP configuration; the port defaults to 587.                                      |
| `EMAIL_FROM`                                                          | —         | Sender address; required when `SMTP_HOST` is set.                                                                               |
| `INTEGRATIONS_ENCRYPTION_KEY`                                         | —         | Base64url-encoded 32-byte key used instead of the generated `/data/integration-secrets.key` file.                               |
| `LOG_LEVEL`                                                           | `info`    | Pino log level.                                                                                                                 |

Provider credentials are accepted only as complete client ID/client secret pairs, and SMTP authentication requires `SMTP_USER` and `SMTP_PASSWORD` together. If password sign-in is disabled, at least one social provider must remain enabled or startup fails. See `.env.example` for a Compose-oriented template; `DATA_HOST_DIR`, `PRINTS_HOST_DIR`, `PUID`, and `PGID` are Compose substitutions rather than variables read by STL Quest itself.

## Reverse proxy

Configure the proxy to preserve the original host and protocol (`Host` or `X-Forwarded-Host`, plus `X-Forwarded-Proto`) so STL Quest can infer its public origin. Set `BETTER_AUTH_URL` only when those headers cannot represent the public origin, and use `BETTER_AUTH_TRUSTED_ORIGINS` only for additional origins. Mutations are origin-checked, so a proxy that rewrites the public origin without either preserving or configuring it breaks sign-in and saves.

Model uploads are resumable tus requests sent in 32 MB chunks. Allow request bodies of at least that size (for nginx, `client_max_body_size 64m;`); the app itself caps a single upload at 1 GB. Live board updates stream over server-sent events at `/api/events`, so response buffering must be off for that path.

### Sample configurations

nginx:

```nginx
server {
  server_name stlquest.example.com;
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
stlquest.example.com {
  reverse_proxy 127.0.0.1:3010
}
```

Traefik likewise needs no body-size or buffering overrides; route to the container port:

```yaml
labels:
  - traefik.http.routers.stlquest.rule=Host(`stlquest.example.com`)
  - traefik.http.services.stlquest.loadbalancer.server.port=3000
```

## Health checks

`GET /api/health` returns HTTP 200 with `{ "ok": true, "storage": false, "assets": null }` on a fresh deployment before any workspace exists; at that stage it verifies the database and upload-staging directory but has no workspace model store to test. After setup, HTTP 200 returns `{ "ok": true, "storage": true, "assets": { ... } }` after verifying the database, staging directory, active workspace storage, and asset queue. Any failed check returns HTTP 503 with `{ "ok": false, "error": "..." }`. The container image already uses this endpoint for its built-in `HEALTHCHECK`; point Compose healthchecks, reverse-proxy upstream checks, or uptime monitors at the same endpoint.

## Storage and secrets

Dropbox uses scoped App folder access, Google Drive uses the limited `drive.file` scope, and OneDrive stores files in its application folder. Workspace storage settings, OAuth client secrets, and refresh tokens are encrypted in the database. By default STL Quest generates `/data/integration-secrets.key`; keep that file with database backups. When `INTEGRATIONS_ENCRYPTION_KEY` is set, the file is not used and the exact environment-provided key must be backed up separately and restored before starting STL Quest against the database.

Keep `/data` on a local filesystem. SQLite WAL databases should not be placed on NFS, SMB, or CIFS.

## Backups

Back up `/data` and the active model store at the same recovery point before upgrading. For local storage, copy the configured storage root, including every workspace namespace under it. For S3-compatible, Dropbox, Google Drive, or OneDrive storage, preserve the remote bucket or folder and its object history or provider backup according to that service's recovery model. A database backup alone contains references and encrypted connection settings, not model files or generated previews.

Automatic migrations create a SQLite snapshot under `/data/backups` immediately before changing the schema. These snapshots contain only the database: they do not include local or cloud model storage, upload staging, or an environment-provided encryption key, and they are not a complete operational backup.

For a consistent database backup while the app is running, use the online backup command from a source checkout on the host (the container image does not ship it). It snapshots the live database through SQLite's backup API and copies `/data/integration-secrets.key` alongside when that file exists:

```sh
DATA_DIR=/path/to/appdata pnpm backup --output /path/to/backups/stlquest.sqlite
```

The command does not copy model storage. If `INTEGRATIONS_ENCRYPTION_KEY` supplies the key, store that secret in your backup system separately because there is no key file for the command to copy.

## Restoring

1. Stop the container.
2. Restore the local storage root or the matching remote bucket/folder state from the same recovery point as the database.
3. Replace `/data/stlquest.sqlite` with the database backup, and delete any leftover `stlquest.sqlite-wal` and `stlquest.sqlite-shm` files so stale write-ahead state is not applied to the restored database.
4. Restore the matching `/data/integration-secrets.key`, or configure the exact backed-up `INTEGRATIONS_ENCRYPTION_KEY`, before startup. The wrong or missing key prevents encrypted storage and integration settings from being read.
5. Start the container. If the backup predates the current version, migrations run automatically on boot.

## Upgrading

Pull the new image and recreate the container. Database migrations run automatically before the server accepts requests. Back up `/data` and the active model store together before upgrading so they can be restored to the same recovery point if a rollback is needed.

The default Compose host directory is `./stlquest-data`; set `DATA_HOST_DIR` to use a different location.

## Account recovery

If sign-in breaks — for example a misconfigured social provider — set `AUTH_PASSWORD_RECOVERY=true` and restart to force password sign-in on, fix the provider configuration in the Super Admin area, then remove the variable.
