# Resin catalog

STL Quest includes a generated resin catalog for the private print calculator. Self-hosted installations read it locally and do not contact third-party services while the app is running.

PrusaSlicer supplies the broad material list and any density values present in its SLA profiles. Official manufacturer material pages supplement products missing from that list. `sources.json` pins repository revisions, while `manufacturer-resins.json` records curated manufacturer data and its provenance.

Prices are deliberately excluded because they vary by seller, region, package size, and purchase date. Users select a preset, then save their own price per litre and may override its density.

Run `pnpm catalog:sync` to regenerate both printer and resin catalogs from the recorded revisions. Run `pnpm catalog:update` to update their sources. `pnpm catalog:check` validates both committed catalogs without using the network.
