# Printer catalog

PrintHub ships a generated offline catalog so self-hosted installations never depend on third-party services at runtime.

The catalog is the sourced dataset and its provenance; the application exposes each generated entry as a printer preset.

## Sources

- OrcaSlicer supplies filament printer models, usable build dimensions, and available cover images.
- UVtools supplies the primary resin printer catalog and usable build dimensions.
- Open Resin Alliance supplies supplemental resin definitions and transparent printer artwork for supported manufacturers.
- PrusaSlicer supplies transparent profile thumbnails for Prusa resin printers.
- Official manufacturer product feeds and product pages supply remaining models and images that are missing from the community catalogs, currently HeyGears and Phrozen.

Primary catalog repositories and pinned revisions live in `sources.json`. Supplemental catalog and image sources live in `image-sources.json`, while manufacturer catalog snapshots live in `manufacturer-printers.json`. Open Resin printer definitions are discovered automatically below each configured repository path. Brand normalization, exclusions, and corrections live in `overrides.json` so upstream data remains reproducible while local curation stays explicit.

## Synchronizing

Run `pnpm catalog:sync` to regenerate from the pinned revisions. Run `pnpm catalog:update` to advance every configured GitHub source to its latest branch revision, refresh manufacturer sources, and regenerate the catalog and images.

Run `pnpm catalog:update-images` to refresh supplemental definitions and images at their pinned revisions, plus live manufacturer feeds and product pages, without advancing any GitHub source.

The generated catalog is committed at `catalog.generated.json`. Redistributable cover images are committed under `public/printer-presets/`. The application reads only these local files.

`pnpm catalog:check` validates the committed snapshot, image provenance, and required source license files without network access. It runs as part of `pnpm check`.
