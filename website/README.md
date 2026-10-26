# STL Quest website

The landing website at [stl.quest](https://stl.quest), deployed separately from the application but built from this repository. It renders the application's own components and design tokens, and reads product facts such as workflow stages, storage providers, model formats, and storage plans from `src/core`, so the site cannot describe a product the application no longer is.

## Development

Run every command from the repository root after `pnpm install`:

- `pnpm website:dev` serves the site with the same prerendered markup the build produces.
- `pnpm website:build` writes the static site to `website/dist/`: every page in `src/site.ts` prerendered, plus `sitemap.xml` and `llms.txt`. `pnpm check` runs it, and the repository's format, lint, and typecheck gates cover `website/`.

`website/Dockerfile` builds a Caddy image serving that output; build it from the repository root with `docker build -f website/Dockerfile .`.

## Product tour media

The reproducible Playwright capture scripts for the landing-page video and README animation live in `scripts/capture/`. See [Capturing product tour media](docs/product-tour-capture.md) for the workflow.

## Analytics

The site sends anonymous product analytics, web vitals, errors, heatmaps, and session replays to PostHog. The public project token, proxied ingestion host, and PostHog UI host are configured in `website/.env`; override them with Vite environment variables when testing another project.
