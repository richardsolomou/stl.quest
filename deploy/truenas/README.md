# TrueNAS catalog package

Since TrueNAS 24.10, the Apps screen is fed by the official [truenas/apps](https://github.com/truenas/apps) catalog. This directory contains the STL Quest community-app package for submission as `ix-dev/community/stlquest/`.

Before submitting:

1. Search the TrueNAS Apps issues and pull requests, then open the required App Request issue.
2. Copy `stlquest/` to `ix-dev/community/stlquest/` in a fork of truenas/apps.
3. Leave `lib_version_hash` empty and set `lib_version` to their latest non-v1 library; their tooling fills the hash and copies the library into the package.
4. Run every file under `templates/test_values/` through their CI runner, then run the metadata, port, and full catalog validators.
5. Attach `public/favicon.svg` in the PR; a maintainer uploads it to the TrueNAS CDN and returns the `icon:` URL.
6. Use Node 24 and exactly pnpm 11.12.0 (`corepack prepare pnpm@11.12.0 --activate`). `pnpm version-packages` synchronizes `app_version` and the versioned container image tag for application releases; update `date_added` and the catalog package version when preparing a catalog submission.

Re-check the compose template's library calls (health check, storage, and port helpers) against the selected catalog library version before submitting.

## Custom App installation

Until the catalog package lands, create a Custom App with these settings:

- Image: `ghcr.io/richardsolomou/stl.quest:latest`
- Container port: `3000` over TCP
- User and group: any non-root IDs with write access to both mounted paths
- App data mount: `/data` on a local TrueNAS dataset
- Print files mount: `/prints` on a separate dataset or directory
- Health check: `wget -q --spider http://127.0.0.1:3000/api/health`

Keep `/data` on a local filesystem because it contains the SQLite database. Open the web UI immediately after deployment; the first account created becomes the administrator.
