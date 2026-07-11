# Migrating from the Convex-backed PrintHub

The standalone build keeps your STL files exactly where they are and imports the Convex metadata (requests, per-status copy counts, users, thumbnails) into SQLite under `/data`. Nothing is deleted from Convex, so you can roll back until you decommission it.

## 1. Back up

- Export Convex data: `npx convex export --path printhub-export.zip` in the old app's checkout, then unzip it.
- Snapshot or copy the prints directory on your NAS (the folder mounted at `/prints`, containing `todo/`, `in-progress/`, `done/`, `.previews/`).

## 2. Stop the old app

Stop the old container (and its Cloudflare Tunnel if you plan to reuse the hostname). Convex stays untouched.

## 3. Deploy the new image

Mount a **fresh, empty** directory at `/data` and the **same prints directory** at `/prints` (see the README's Docker section or [`examples/cloudflare-nas`](examples/cloudflare-nas/README.md)). Don't start it yet — or if it started, stop it before importing.

## 4. Import

Run the importer from a checkout of this repository (Node 22+, `pnpm install` first), pointing at the unzipped export and both mounts:

```sh
pnpm migrate:convex -- \
  --export ./printhub-export \
  --data /mnt/HDDs/STL/.printhub-data \
  --prints /mnt/HDDs/STL \
  --operators you@example.com \
  --operator you@example.com --operator-password <a password of 8+ characters>
```

- `--operators` marks the listed emails (your old `ADMIN_EMAILS`) as operators; everyone else imports as a requester.
- `--operator`/`--operator-password` give one account a built-in login so you can sign in before (or instead of) configuring the proxy. Skip it if you will only ever use trusted-header auth.
- The importer moves `.previews/*` into the new `.printhub/previews/` layout, verifies every request's file exists on disk (warning if not), records the prints location in settings, and refuses to run against a database that already has requests.

## 5. First start

Start the container and open the app. Sign in with the `--operator` credentials. Verify the board: columns and copy counts should match the old app, thumbnails render, and downloads work.

## 6. Reconnect Cloudflare Access (optional)

The old deployment authenticated with Cloudflare Access headers; the new app configures that in **Settings → Authentication** instead of env vars:

1. Point the tunnel at the new container and add a Transform Rule that sets `X-PrintHub-Proxy-Secret` to a random value of at least 24 characters (see the cloudflare-nas example).
2. While signed in **through the tunnel**, open Settings → Authentication, pick trusted-header, and enter the header (`Cf-Access-Authenticated-User-Email`), the same secret, and the operator emails. The save only succeeds when the request already carries those headers, so you cannot lock yourself out.

Your teammates keep signing in through Access exactly as before; their accounts were imported with the same emails, names, and colors.

## Recovery and rollback

- Locked out of authentication settings: `sqlite3 /data/printhub.sqlite "DELETE FROM settings WHERE key='auth'"` and restart — the instance falls back to built-in accounts.
- Rolling back: stop the new container, start the old one. Convex data was never modified. The only disk change the importer makes is moving `.previews/*` to `.printhub/previews/*`; move those files back if you return to the old app permanently.
