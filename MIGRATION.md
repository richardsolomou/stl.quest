# Migrating from the Convex-backed PrintHub

The standalone build keeps the existing NAS print directory mounted in the same place and imports the Convex metadata (requests, per-status copy counts, users, thumbnails) into SQLite. Create a new `.printhub` directory alongside the application and mount it at `/data`; the existing NAS print directory remains mounted at `/prints`.

For example:

```text
/path/to/printhub/
├── .printhub/          # new application data, including printhub.sqlite
└── docker-compose.yml

/existing/NAS/prints/   # existing print storage; remains in place
├── todo/
├── in-progress/
├── done/
└── .previews/
```

Nothing is deleted from Convex, so you can roll back until you decommission it.

## 1. Back up

- Export Convex data: `npx convex export --path printhub-export.zip` in the old app's checkout, then unzip it.
- Snapshot or copy the existing prints directory on your NAS (the folder mounted at `/prints`, containing `todo/`, `in-progress/`, `done/`, and `.previews/`). The original STL files remain in this directory throughout the migration.

## 2. Stop the old app

Stop the old container (and its Cloudflare Tunnel if you plan to reuse the hostname). Convex stays untouched.

## 3. Prepare the new deployment

Create a fresh, empty `.printhub` directory alongside the application. Configure the new container with these mounts:

```yaml
volumes:
  - /path/to/printhub/.printhub:/data
  - /existing/NAS/prints:/prints
```

The first mount is new application data. The second is the same NAS print directory used by the Convex-backed deployment; do not copy or relocate it. Don't start the new container yet — or, if it has already started, stop it before importing.

## 4. Import

Run the importer from a checkout of this repository using Node 22 and `pnpm install --frozen-lockfile`. Point `--data` at the new host-side `.printhub` directory and `--prints` at the existing host-side NAS print directory.

First, rehearse the complete import without changing the database or filesystem:

```sh
pnpm migrate:convex \
  --export ./printhub-export \
  --prints /existing/NAS/prints \
  --admins you@example.com \
  --admin you@example.com \
  --admin-password '<a password of at least 12 characters>' \
  --dry-run
```

After stopping the old application, run the real import:

```sh
pnpm migrate:convex \
  --export ./printhub-export \
  --data /path/to/printhub/.printhub \
  --prints /existing/NAS/prints \
  --admins you@example.com \
  --admin you@example.com \
  --admin-password '<a password of at least 12 characters>'
```

- `--dry-run` exercises the complete import against an in-memory database and requires every referenced original print file to be present without modifying anything. It is safe to run while the old app is live, and it does not require `--data`.
- `--admins` is a comma-separated list of the emails from the old `ADMIN_EMAILS` setting that should have the admin role. Everyone else imports as a requester.
- `--admin` and `--admin-password` create a working built-in login for one admin. The password must contain at least 12 characters. Do not omit these options, or nobody will initially have a password with which to sign in.
- The importer writes `printhub.sqlite` into `/path/to/printhub/.printhub`; that host directory is later mounted at `/data`.
- Original STL files and their paths remain in the existing NAS print directory. The importer verifies that every referenced file exists there.
- The importer relocates legacy derived previews from `.previews/` to `.printhub/previews/` inside the same NAS print directory and writes decoded thumbnails under `.printhub/thumbnails/`. It does not relocate the original print files.
- The importer refuses to run if the target SQLite database already contains requests.

## 5. Verify the import

Before starting the app, run the independent verifier — it compares every exported field against the imported database and the files on disk:

```sh
pnpm verify:convex \
  --export ./printhub-export \
  --data /path/to/printhub/.printhub \
  --prints /existing/NAS/prints
```

It must exit successfully, end with `NO METADATA MISMATCHES`, and report full STL, thumbnail, and preview counts. Any mismatch exits non-zero and lists the exact request and field that differs.

## 6. First start

Start the container with `/path/to/printhub/.printhub` mounted at `/data` and the unchanged NAS print directory mounted at `/prints`. Open the app and sign in with the `--admin` credentials. Verify that the board columns and copy counts match the old app, thumbnails and previews render, and downloads work.

## 7. Let teammates back in

The old deployment authenticated with Cloudflare Access headers; the new app uses built-in email/password accounts. Your teammates' accounts were imported with the same emails, names, and colors, but without passwords. Set one for each under **Settings → Users → Set password** and share it with them directly; they can change it themselves afterwards under Account.

New people never need a password handoff: **Settings → Users → Invite with link** creates a single-use link; whoever opens it picks their own credentials.

If you keep the Cloudflare Tunnel, it now only provides ingress. An Access policy in front still works as an extra gate, but PrintHub no longer reads its identity headers.

## Rollback

Stop the new container, start the old one. Convex data was never modified. The only disk change the importer makes is moving `.previews/*` to `.printhub/previews/*`; move those files back if you return to the old app permanently.
