# STL Quest Spoolman bridge

Sends a [Spoolman](https://github.com/Donkie/Spoolman)'s spools to STL Quest, so filament stock comes from Spoolman. It runs next to Spoolman and only connects out. Setup, settings, and the endpoint it sends to are in [docs/spoolman.md](../docs/spoolman.md).

`bridge.ts` has no dependencies; Node 24 runs it directly. The image is published as `ghcr.io/richardsolomou/stl.quest-spoolman-bridge` by `.github/workflows/spoolman-bridge.yml`.
