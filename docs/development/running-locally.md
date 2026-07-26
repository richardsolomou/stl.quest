# Running STL Quest locally

Install Node 24.x and pnpm 11.12.0, then install dependencies:

```sh
pnpm install
```

Create local data directories and start the development server:

```sh
mkdir -p data-dev prints-dev
DATA_DIR=./data-dev PRINTS_DIR=./prints-dev BETTER_AUTH_URL=http://localhost:3000 pnpm dev
```

Open `http://localhost:3000`. The first account created becomes the super admin.

To start again with an empty installation, delete `data-dev/` and `prints-dev/`. To test with real data, point `DATA_DIR` at a disposable copy of a production snapshot. The ignored `/local/` directory is the usual place for it. Startup may migrate the database, so never use the original snapshot.

In development, Vite needs the `devApiImages` workaround in `vite.config.ts` to serve `/api/*` image requests. Production does not use this path because Nitro serves the application through one handler.

## Checking UI changes

Open the running app and inspect every affected screen. Check both desktop and the 320 px mobile viewport.

Run the screenshot-enabled end-to-end suite when a change affects several screens. See [End-to-end testing](e2e-testing.md) for the command, output locations, suite structure, and debugging guidance. Review the images locally and attach relevant ones to the pull request. Never commit them to the repository.
