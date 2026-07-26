# TrueNAS catalog package

TrueNAS 24.10 and later load apps from the official [truenas/apps](https://github.com/truenas/apps) catalog. This directory contains the STL Quest package that is submitted to `ix-dev/community/stlquest/`.

To prepare a submission:

1. Search the TrueNAS Apps issues and pull requests, then open the required App Request issue.
2. Copy `stlquest/` to `ix-dev/community/stlquest/` in a fork of truenas/apps.
3. Leave `lib_version_hash` empty. Set `lib_version` to the latest library newer than v1. The TrueNAS tools fill in the hash and copy the library into the package.
4. Test every file under `templates/test_values/` with the TrueNAS CI runner. Then run its metadata, port, and full catalog validators.
5. Attach `public/favicon.svg` in the PR; a maintainer uploads it to the TrueNAS CDN and returns the `icon:` URL.
6. Use Node 24 and exactly pnpm 11.12.0 (`corepack prepare pnpm@11.12.0 --activate`). For application releases, `pnpm version-packages` keeps `app_version` and the container image tag in sync. When preparing a catalog submission, update `date_added` and the catalog package version.

Re-check the compose template's library calls (health check, storage, and port helpers) against the selected catalog library version before submitting.

## Custom App installation

Until STL Quest is available in the catalog, create a Custom App with these settings:

- Image: `ghcr.io/richardsolomou/stl.quest:latest`
- Container port: `3000` over TCP
- User and group: any non-root IDs with write access to both mounted paths
- App data mount: `/data` on a local TrueNAS dataset
- Print files mount: `/prints` on a separate dataset or directory
- Health check: `wget -q --spider http://127.0.0.1:3000/api/health`

Keep `/data` on a local filesystem because it contains the SQLite database. Open the web UI immediately after deployment; the first account created becomes the administrator.
