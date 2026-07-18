---
name: running-the-app
description: Launch PrintHub locally and verify changes visually — dev server setup, admin bootstrap, and the screenshot norms UI changes are held to. Use when a change needs to be seen running, not just pass tests.
---

# Running the app

Launch:

```sh
mkdir -p data-dev prints-dev
DATA_DIR=./data-dev PRINTS_DIR=./prints-dev BETTER_AUTH_URL=http://localhost:3000 pnpm dev
```

- The first account created at `http://localhost:3000` becomes the deployment admin. To start fresh, delete `data-dev/` (database) and `prints-dev/` (stored models).
- The dev server serves `/api/*` images through a Vite middleware workaround (`devApiImages` in `vite.config.ts`); production behaves slightly differently because Nitro serves everything through one handler.

Verifying UI changes — the norms this repo's PRs are held to:

- Look at the running thing; never report a visual fix from code-reasoning alone.
- Check the 320px mobile viewport, not just desktop.
- A local (non-CI) `pnpm test:e2e` run writes journey screenshots to `test-results/manual-inspection/` — a cheap way to eyeball every major screen after a change.
- Attach screenshots to the PR for UI changes; never commit them to the repo.
