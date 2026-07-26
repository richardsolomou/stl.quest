# Changing deployment configuration

When changing anything an operator configures, review and update every relevant file in this list:

- `docs/deployment.md` for environment variables, reverse proxies, health checks, backups, and upgrades
- `README.md` for installation and configuration summaries
- `.env.example`
- `docker-compose.yml`
- `deploy/truenas/stlquest/app.yaml`, `questions.yaml`, and `README.md`
- `deploy/unraid/stlquest.xml`

Add environment variables only for file paths, deployment controls, recovery, or read-only overrides managed by the host. Product configuration belongs in Settings, backed by the `settings` or `deployment_settings` table.

Do not change the version in `deploy/truenas/stlquest/app.yaml` by hand. `scripts/syncReleaseVersion.ts` updates it during a release.

The Docker build must include everything pnpm needs. In particular, `pnpm-workspace.yaml` contains the supply-chain policy and must be copied into the image build.

The container runs with a read-only filesystem and a temporary `/tmp`. Persistent writes must go below `DATA_DIR` or `PRINTS_DIR`.

Keep `/data` on a local filesystem. SQLite write-ahead logging is not safe on NFS, SMB, or CIFS.
