---
name: shipping-deploy-config
description: Fan-out checklist for deployment-affecting changes (env vars, volumes, ports, upload formats) — the manifests that must change together. Use when touching .env.example, Dockerfile, docker-compose.yml, or anything an operator configures.
---

# Shipping deployment config

Any change an operator can see must land in all of these together — forgetting the deploy manifests is the most common miss in this repo's history:

- `README.md` (Run it / Configuration table)
- `.env.example`
- `docker-compose.yml`
- `deploy/truenas/printhub/app.yaml`, `questions.yaml`, and `README.md`
- `deploy/unraid/printhub.xml`

Rules:

- New env vars are allowed only for filesystem paths, operational controls, recovery, or read-only managed-deployment overrides. Product configuration belongs in Settings (the `settings`/`deployment_settings` tables).
- `deploy/truenas/printhub/app.yaml`'s version field is synced by `scripts/syncReleaseVersion.ts` on release — never bump it by hand.
- The Docker build must carry everything pnpm needs (`pnpm-workspace.yaml` holds the supply-chain policy and its omission has broken the image build before).
- The container runs `--read-only` with a tmpfs `/tmp`; anything that writes must live under `DATA_DIR` or `PRINTS_DIR`.
- Keep `/data` guidance intact: SQLite WAL must not live on NFS/SMB/CIFS.
