# STL Quest Spoolman bridge

Sends a [Spoolman](https://github.com/Donkie/Spoolman)'s spools to STL Quest, so filament stock comes from Spoolman, and adds the spools STL Quest queues from pasted orders. Given a [Bambuddy](https://github.com/maziggy/bambuddy) API key, it also sends which spools each print used, and the sliced file of each print STL Quest asks for from Bambuddy's archive. It runs next to Spoolman and only connects out. Setup, settings, and the endpoints it uses are in [docs/spoolman.md](../docs/spoolman.md) and [docs/bambuddy.md](../docs/bambuddy.md#grams-per-spool) ([sliced files](../docs/bambuddy.md#sliced-files)).

`bridge.ts` has no dependencies; Node 24 runs it directly. The image is published as `ghcr.io/richardsolomou/stl.quest-spoolman-bridge` by `.github/workflows/spoolman-bridge.yml`.
