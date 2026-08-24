# Deployment guide

This guide covers production setup, backups, restores, upgrades, and troubleshooting for self-hosted installations. For a quick start, see the [README](../README.md).

## Platform app stores

### TrueNAS SCALE and HexOS

Install [STL Quest from the TrueNAS Apps catalog](https://apps.truenas.com/catalog/stlquest_community/). In TrueNAS, open **Apps**, search for **STL Quest**, select it, and configure the app data and print file storage before installing. Keep app data on a local dataset because it contains the SQLite database. Open the web UI immediately after deployment; the first account created becomes the super admin.

The [TrueNAS deployment notes](../deploy/truenas/README.md) cover the catalog package and the Custom App fallback.

### Unraid

Install [STL Quest from Unraid Community Apps](https://ca.unraid.net/apps?q=STL-Quest). In Unraid, open **Apps**, search for **STL Quest**, select it, and configure the app data and print files paths before applying the template. Keep app data on the cache-backed appdata share and store print files on the share you want STL Quest to manage.

If Community Apps is unavailable, use the repository's [`stlquest.xml`](../deploy/unraid/stlquest.xml) template manually.

## Environment variables

Most settings belong in **Workspace Settings** or **Super Admin**. Environment variables are for file paths, deployment controls, settings managed by the host, and account recovery. If you configure a sign-in provider or email delivery both in the app and through environment variables, the environment variables win. Super Admin labels those settings as environment-managed.

| Variable                                                                             | Default   | Purpose                                                                                                                         |
| ------------------------------------------------------------------------------------ | --------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `PORT`                                                                               | `3000`    | TCP port exposed by the container's built-in web and realtime proxy.                                                            |
| `DATA_DIR`                                                                           | `/data`   | Database, pre-migration database snapshots, upload staging, and the generated integration encryption key.                       |
| `DATABASE_URL`                                                                       | —         | PostgreSQL (`postgres://` or `postgresql://`) URL. SQLite is used when unset.                                                   |
| `STLQUEST_DISTRIBUTED`                                                               | `false`   | Enables multi-replica mode and requires PostgreSQL, Redis/Valkey, S3-compatible upload staging, and shared encryption keys.     |
| `REDIS_URL`                                                                          | —         | Redis or Valkey (`redis://` or `rediss://`) URL used for distributed locks, upload metadata, and cross-replica events.          |
| `S3_BUCKET`, `S3_REGION`                                                             | —         | Shared S3-compatible bucket and region for resumable uploads in distributed mode.                                               |
| `S3_ENDPOINT`                                                                        | AWS       | Optional HTTP or HTTPS endpoint for R2, MinIO, and other S3-compatible services.                                                |
| `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`                                           | provider  | Optional explicit credentials; configure both or use the AWS SDK credential chain.                                              |
| `S3_FORCE_PATH_STYLE`                                                                | `false`   | Enables path-style bucket URLs for providers that require them.                                                                 |
| `ASSET_WORKER_CONCURRENCY`                                                           | `8`       | Maximum visual asset jobs processed concurrently by each replica.                                                               |
| `ASSET_WORKER_MEMORY_MB`                                                             | `4096`    | Per-replica source-memory budget shared by visual asset jobs.                                                                   |
| `PRINTS_DIR`                                                                         | `/prints` | Default local model-storage root used until a workspace storage setting is saved.                                               |
| `PRINTS_DIR_OVERRIDE`                                                                | —         | Recovery override for saved local storage paths. Remote storage providers are unaffected.                                       |
| `STLQUEST_HOSTED`                                                                    | `false`   | Enables hosted sign-up behavior, disables local storage by default, and skips automatic super-admin assignment.                 |
| `STLQUEST_HOSTED_STORAGE_BUCKET`, `STLQUEST_HOSTED_STORAGE_ENDPOINT`                 | —         | Enables deployment-managed S3-compatible storage for hosted workspaces when both and the credential pair below are set.         |
| `STLQUEST_HOSTED_STORAGE_ACCESS_KEY_ID`, `STLQUEST_HOSTED_STORAGE_SECRET_ACCESS_KEY` | —         | Server-only credentials for managed storage; they are never saved in workspace settings or returned to clients.                 |
| `STLQUEST_HOSTED_STORAGE_REGION`                                                     | `auto`    | S3 region for managed storage. Cloudflare R2 uses `auto`.                                                                       |
| `STLQUEST_HOSTED_STORAGE_PREFIX`                                                     | —         | Optional bucket prefix. Objects are additionally isolated below `workspaces/<workspace-id>/`.                                   |
| `STLQUEST_HOSTED_STORAGE_FORCE_PATH_STYLE`                                           | `false`   | Enables path-style requests for a managed S3-compatible provider that requires them.                                            |
| `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`                                         | —         | Enables Stripe Managed Payments on hosted deployments when both plan price IDs below are also configured.                       |
| `STRIPE_SUPPORTER_PRICE_ID`, `STRIPE_PRO_PRICE_ID`                                   | —         | Monthly Stripe Price IDs for the 25 GB Supporter and 100 GB Pro plans.                                                          |
| `BETTER_AUTH_URL`                                                                    | —         | Optional public HTTP or HTTPS origin override for reverse proxies and custom domains.                                           |
| `BETTER_AUTH_TRUSTED_ORIGINS`                                                        | —         | Additional trusted origins, comma-separated.                                                                                    |
| `AUTH_PASSWORD_ENABLED`                                                              | stored    | Overrides the Super Admin setting for password sign-in. Defaults to enabled when neither source has a value.                    |
| `AUTH_PASSWORD_RECOVERY`                                                             | `false`   | Forces password sign-in on regardless of stored settings or `AUTH_PASSWORD_ENABLED`; see [Account recovery](#account-recovery). |
| `AUTH_GOOGLE_CLIENT_ID`, `AUTH_GOOGLE_CLIENT_SECRET`                                 | —         | Google OAuth credentials. Both variables must be set together; an environment pair replaces the stored Google configuration.    |
| `AUTH_GOOGLE_ENABLED`                                                                | `true`    | Enables an environment-configured Google provider. False values are `0`, `false`, `no`, or `off`, case-insensitively.           |
| `AUTH_DISCORD_CLIENT_ID`, `AUTH_DISCORD_CLIENT_SECRET`                               | —         | Discord OAuth credentials. Both variables must be set together; an environment pair replaces the stored Discord configuration.  |
| `AUTH_DISCORD_ENABLED`                                                               | `true`    | Enables an environment-configured Discord provider. False values are `0`, `false`, `no`, or `off`, case-insensitively.          |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASSWORD`                | —         | Setting `SMTP_HOST` replaces the Super Admin SMTP configuration; the port defaults to 587.                                      |
| `EMAIL_FROM`                                                                         | —         | Sender address; required when `SMTP_HOST` is set.                                                                               |
| `INTEGRATIONS_ENCRYPTION_KEY`                                                        | —         | Base64url-encoded 32-byte key used instead of the generated `/data/integration-secrets.key` file.                               |
| `STLQUEST_REALTIME_SECRET`                                                           | generated | Realtime signing key generated in `/data/realtime-secret`; set the same value on every distributed replica.                     |
| `LOG_LEVEL`                                                                          | `info`    | Pino log level.                                                                                                                 |

For hosted billing, activate Managed Payments in Stripe and accept its terms before configuring STL Quest. Create monthly Supporter and Pro products priced at $5 and $10 with a Managed Payments-eligible SaaS tax code, then copy their Price IDs into the variables above. Add a Stripe webhook endpoint at `https://your-domain/api/auth/stripe/webhook` for `checkout.session.completed` and the `customer.subscription.created`, `customer.subscription.updated`, and `customer.subscription.deleted` events. Stripe provides the signing secret used by `STRIPE_WEBHOOK_SECRET`.

Always set a provider's client ID and client secret together. For authenticated SMTP, set both `SMTP_USER` and `SMTP_PASSWORD`. If you disable password sign-in, at least one social sign-in provider must stay enabled or STL Quest will not start.

See `.env.example` for a Docker Compose template. `DATA_HOST_DIR`, `PRINTS_HOST_DIR`, `WEB_PORT`, `PUID`, and `PGID` are used by Compose; STL Quest does not read them directly.

## Reverse proxy

Your proxy must pass the original hostname and protocol using `Host` or `X-Forwarded-Host`, plus `X-Forwarded-Proto`. STL Quest uses these headers to work out its public URL. Set `BETTER_AUTH_URL` only if the headers cannot describe that URL, and use `BETTER_AUTH_TRUSTED_ORIGINS` only when you need to allow extra origins.

The container accepts forwarded headers only when its immediate proxy peer is on a private or loopback network. Keep the outer proxy and STL Quest on the same private container or host network; forwarded headers sent directly by public clients are replaced.

STL Quest checks the origin of every request that changes data. If the proxy rewrites the public URL without preserving or configuring it, sign-in and save actions will fail.

Model uploads use resumable 32 MB chunks. Allow request bodies larger than 32 MB; the nginx example below uses 64 MB. STL Quest limits each uploaded file to 1 GB. Realtime updates use a WebSocket at `/connection/websocket`, so the proxy must pass protocol upgrades.

### Sample configurations

nginx:

```nginx
server {
  server_name stlquest.example.com;
  client_max_body_size 64m;

  location / {
    proxy_pass http://127.0.0.1:30455;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-Proto $scheme;
  }

  location /connection/ {
    proxy_pass http://127.0.0.1:30455;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
  }
}
```

Caddy sets the forwarded headers, streams responses, and imposes no body limit by default:

```text
stlquest.example.com {
  reverse_proxy 127.0.0.1:30455
}
```

Traefik likewise needs no body-size or buffering overrides; route to the container port:

```yaml
labels:
  - traefik.http.routers.stlquest.rule=Host(`stlquest.example.com`)
  - traefik.http.services.stlquest.loadbalancer.server.port=3000
```

## Health checks

Use `GET /api/health` for container, proxy, and uptime checks. The container image already uses this endpoint.

A healthy response is HTTP 200 with `{ "ok": true }`. It checks the database and upload staging, which are required for the application to run. Distributed mode therefore checks its shared S3 staging bucket. Workspace storage is excluded because customer-controlled storage may be temporarily unavailable and must not prevent the container from starting. A failed check returns HTTP 503 with `{ "ok": false, "error": "..." }`.

## Storage and secrets

By default, STL Quest creates encryption and realtime signing keys at `/data/integration-secrets.key` and `/data/realtime-secret`. Back them up with the database. If you set `INTEGRATIONS_ENCRYPTION_KEY` or `STLQUEST_REALTIME_SECRET`, back up the exact environment value separately and restore it before starting the app with the database.

Keep `/data` on a local filesystem. SQLite WAL databases should not be placed on NFS, SMB, or CIFS. A remote PostgreSQL database does not remove the need for `/data`, which still holds upload staging and the generated integration encryption key.

## Distributed deployments

Set `STLQUEST_DISTRIBUTED=true` only when every replica has the same `DATABASE_URL`, `REDIS_URL`, S3 configuration, `INTEGRATIONS_ENCRYPTION_KEY`, and `STLQUEST_REALTIME_SECRET`. Local model storage is disabled. Empty workspaces can open Settings, but they must configure remote storage before accepting uploads.

Distributed replicas do not require `/data` or `/prints` mounts. Single-instance deployments using SQLite, generated encryption keys, local upload staging, or local model storage must mount the applicable paths explicitly.

Redis or Valkey coordinates resumable uploads, recovery, asset generation, replica-internal storage invalidation, realtime delivery, and presence. The S3-compatible staging bucket holds incomplete uploads and must be shared by every replica. Configure a bucket lifecycle rule to abort incomplete multipart uploads and expire unfinished TUS objects after two days.

The first distributed startup refuses workspaces that still contain local model records, active storage migrations, or incomplete uploads. It records a successful cutover in PostgreSQL so later replicas and rolling deployments can start while shared uploads are active.

### Converting an existing PostgreSQL deployment

Distributed mode expects an existing PostgreSQL deployment. SQLite installations remain single-instance deployments.

1. Back up PostgreSQL, `/data`, and model storage.
2. In every workspace using local model storage, use **Settings → Storage** to migrate to a remote provider and wait for the migration to complete.
3. Let active resumable uploads finish, then stop the existing container so no uploads or database writes can begin during the cutover. Local resumable uploads cannot continue from distributed S3 staging.
4. Promote the existing integration key to a deployment secret. The following command prints its base64url value; store it directly as `INTEGRATIONS_ENCRYPTION_KEY`:

```sh
node -e "process.stdout.write(require('node:fs').readFileSync('/path/to/data/integration-secrets.key').toString('base64url'))"
```

1. Generate a shared realtime signing key with `openssl rand -base64 48` and store it as `STLQUEST_REALTIME_SECRET` on every replica.
1. Configure PostgreSQL, Redis, S3 variables, and `STLQUEST_DISTRIBUTED=true` identically on every replica.
1. Start one replica and verify `/api/health`, authentication, workspace storage, and an upload before increasing the replica count and enabling start-first rolling updates.

To roll back the cutover, stop every distributed replica and restore the original single-instance PostgreSQL configuration, key, and storage backup together.

## Backups

Back up `/data` and the current model storage together before upgrading. For local storage, copy the configured storage root and every workspace folder below it. For cloud storage, back up the bucket or folder using the provider's versioning or backup tools. The database stores file references and encrypted connection settings, not the models or generated previews themselves.

Automatic migrations create a SQLite snapshot under `/data/backups` immediately before changing the schema. PostgreSQL deployments rely on their database provider's backup and point-in-time recovery instead. Database backups do not include local or cloud model storage, upload staging, or an environment-provided encryption key.

For a consistent database backup while the app is running, use the online backup command from a source checkout on the host (the container image does not ship it). It snapshots the live database through SQLite's backup API and copies `/data/integration-secrets.key` alongside when that file exists:

```sh
DATA_DIR=/path/to/appdata pnpm backup --output /path/to/backups/stlquest.sqlite
```

The command supports local SQLite only and does not copy model storage. For PostgreSQL, use the provider's backup tooling. If `INTEGRATIONS_ENCRYPTION_KEY` supplies the key, store that secret in your backup system separately because there is no key file for the command to copy.

## Restoring

1. Stop the container.
2. Restore the local storage root or the matching remote bucket/folder state from the same recovery point as the database.
3. Replace `/data/stlquest.sqlite` with the database backup, and delete any leftover `stlquest.sqlite-wal` and `stlquest.sqlite-shm` files so stale write-ahead state is not applied to the restored database.
4. Restore the matching `/data/integration-secrets.key`, or configure the exact backed-up `INTEGRATIONS_ENCRYPTION_KEY`, before startup. The wrong or missing key prevents encrypted storage and integration settings from being read.
5. Start the container. If the backup predates the current version, migrations run automatically on boot.

## Upgrading

Back up `/data` and model storage together, then pull the new image and recreate the container. STL Quest updates the database before it accepts requests. It then applies any missing file-storage updates to each workspace in order, even if you skipped one or more releases. Keeping the two backups from the same point in time lets you roll back safely.

Upgrades from 1.26.1 or earlier must stop every replica before starting the new image. The upgrade begins encrypting OAuth access and refresh tokens, and an older replica cannot read tokens written by the new release. Stop every replica before a rollback too; users whose tokens were created or refreshed after the upgrade may need to reconnect their provider.

The default Compose host directory is `./stlquest-data`; set `DATA_HOST_DIR` to use a different location.

## Account recovery

If a sign-in provider is misconfigured and you cannot log in, set `AUTH_PASSWORD_RECOVERY=true` and restart STL Quest. This temporarily enables password sign-in. Fix the provider in **Super Admin**, remove the environment variable, and restart again.
