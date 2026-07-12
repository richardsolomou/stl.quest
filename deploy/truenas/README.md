# TrueNAS catalog submission draft

Since TrueNAS 24.10, the Apps screen is fed only by the official [truenas/apps](https://github.com/truenas/apps) catalog; getting PrintHub listed means a pull request adding `ix-dev/community/printhub/` there. This directory is that submission, drafted in advance so it is copy-paste ready once the repo is public and the first image is published.

Before submitting:

1. Copy `printhub/` to `ix-dev/community/printhub/` in a fork of truenas/apps.
2. Leave `lib_version_hash` empty and set `lib_version` to their current 2.x library; their tooling fills the hash.
3. Validate locally with their CI runner: `./.github/scripts/ci.py --app printhub --train community --test-file basic-values.yaml`.
4. Attach `public/favicon.svg` in the PR; a maintainer uploads it to the TrueNAS CDN and returns the `icon:` URL.
5. Update `date_added` and versions.

The compose template's library calls (`healthcheck.set_custom_test`, storage/port helpers) follow the patterns of current community apps but must be re-checked against the library version at submission time — the render library evolves.

Until this lands, TrueNAS users install PrintHub as a Custom App (see the main README).
