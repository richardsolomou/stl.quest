# Resin catalog

STL Quest includes a generated resin catalog for the private print calculator. Self-hosted installations read it locally and do not contact third-party services while the app is running.

PrusaSlicer supplies the broad material list and any density values present in its SLA profiles. Official manufacturer material pages supplement products missing from that list. `sources.json` pins repository revisions, while `manufacturer-resins.json` records curated manufacturer data and its provenance.

`formlabs-resins.json` is a committed snapshot of Formlabs' current SLA resins. The SLA products on the official [materials listing](https://formlabs.com/global/products/materials/) supply names, product pages, and categories, and the [data sheets index](https://formlabs.com/global/materials/data-sheets/) links each one to its US English safety data sheet (SDS), whose section 9 supplies the density. Each preset records its product page and SDS URL, and the snapshot records the date it was checked. Pigments, kits, starter packs, ceramic resins, SLS powders, and resins whose SDS states no density are skipped. Densities stated in g/cm³ or kg/L are used as g/mL unchanged; a stated range uses its midpoint, which the preset's density note records. Categories map to catalog types in priority order: Casting, Elastomeric (Flexible), Medical, General Purpose (Model), Dental (Medical), Impact Resistant (Tough), then High Stiffness, Temperature Resistant, or Specialty (Engineering).

Prices are deliberately excluded because they vary by seller, region, package size, and purchase date. Users select a preset, then save their own price per litre and may override its density.

Run `pnpm catalog:sync` to regenerate both printer and resin catalogs from the recorded revisions and snapshots. Run `pnpm catalog:update` to update their sources; refreshing the Formlabs snapshot fetches about 60 pages and PDFs at one request per second per host and needs Poppler's `pdftotext` on `PATH`. `pnpm catalog:check` validates both committed catalogs without using the network.
