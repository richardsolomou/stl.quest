# Printer catalog

PrintHub ships a generated offline catalog so self-hosted installations never depend on third-party services at runtime.

## Sources

- OrcaSlicer supplies filament printer models, usable build dimensions, and available cover images.
- UVtools supplies the primary resin printer catalog and usable build dimensions.
- Open Resin Alliance supplies supplemental resin definitions and transparent printer artwork for supported manufacturers.
- PrusaSlicer supplies transparent profile thumbnails for Prusa resin printers.
- Official manufacturer product feeds supply remaining models that are missing from the community catalogs, currently HeyGears.

Source repositories and pinned revisions live in `sources.json`. Manufacturer feed snapshots live in `manufacturer-printers.json`, while their feed configuration lives in `image-sources.json`. Open Resin printer definitions are discovered automatically below each configured repository path. Brand normalization, exclusions, and corrections live in `overrides.json` so upstream data remains reproducible while local curation stays explicit.

## Synchronizing

Run `pnpm catalog:sync` to regenerate from the pinned revisions. Run `pnpm catalog:update` to advance both sources to their latest configured branches and regenerate the catalog.

Run `pnpm catalog:update-images` to refresh manufacturer feed definitions and images without advancing the OrcaSlicer or UVtools revisions.

The generated catalog is committed at `catalog.generated.json`. Redistributable cover images are committed under `public/printer-presets/`. The application reads only these local files.

`pnpm catalog:check` validates the committed snapshot without network access and runs as part of `pnpm check`.
