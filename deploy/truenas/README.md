# TrueNAS catalog package

Since TrueNAS 24.10, the Apps screen is fed by the official [truenas/apps](https://github.com/truenas/apps) catalog. This directory contains the PrintHub community-app package for submission as `ix-dev/community/printhub/`.

Before submitting:

1. Copy `printhub/` to `ix-dev/community/printhub/` in a fork of truenas/apps.
2. Leave `lib_version_hash` empty and set `lib_version` to their current 2.x library; their tooling fills the hash.
3. Validate locally with their CI runner: `./.github/scripts/ci.py --app printhub --train community --test-file basic-values.yaml`.
4. Attach `public/favicon.svg` in the PR; a maintainer uploads it to the TrueNAS CDN and returns the `icon:` URL.
5. Use Node 24 and exactly pnpm 11.12.0 (`corepack prepare pnpm@11.12.0 --activate`). `pnpm version-packages` synchronizes `app_version` and the container image tag for application releases; update `date_added` and the catalog package version when preparing a catalog submission.

Re-check the compose template's library calls (`healthcheck.set_custom_test`, storage/port helpers) against the selected catalog library version before submitting.

Until this lands, TrueNAS users install PrintHub as a Custom App (see the main README).
