# Printer catalog

STL Quest includes a generated printer catalog. Self-hosted installations read it from local files and do not contact third-party services while the app is running.

This directory contains the source data, a record of where it came from, and the generated catalog. The app shows each generated entry as a printer preset.

## Sources

- OrcaSlicer supplies filament printer models, usable build dimensions, and available cover images.
- UVtools supplies the primary resin printer catalog and usable build dimensions.
- Open Resin Alliance supplies supplemental resin definitions and transparent printer artwork for supported manufacturers.
- PrusaSlicer supplies transparent profile thumbnails for Prusa resin printers.
- Official manufacturer product feeds and product pages supply remaining models and images that are missing from the community catalogs, currently HeyGears and Phrozen.

`sources.json` lists the main catalog repositories and the exact revisions in use. `image-sources.json` lists additional catalog and image sources. `manufacturer-printers.json` stores snapshots of manufacturer catalogs. The generator finds Open Resin printer definitions below each configured repository path.

Brand name cleanup, exclusions, and corrections live in `overrides.json`. Keeping these changes separate makes the original source data reproducible and the local edits easy to review.

## Synchronizing

Run `pnpm catalog:sync` to regenerate the catalog from the revisions already recorded in the repository. Run `pnpm catalog:update` to move every GitHub source to the latest revision on its configured branch, refresh manufacturer data, and regenerate the catalog and images.

Run `pnpm catalog:update-images` to refresh extra definitions, images, manufacturer feeds, and product pages without changing the recorded GitHub revisions.

The generated catalog is committed at `catalog.generated.json`. Redistributable cover images are committed under `public/printer-presets/`. The application reads only these local files.

`just catalog-check` verifies the committed catalog, records for each image source, and required source license files without using the network. It also runs as part of `just check`.
