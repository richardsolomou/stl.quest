# Catalogs

STL Quest keeps versioned product data under this directory so self-hosted installations do not need external catalog services at runtime.

- [Printers](printers/README.md) contains printer models, dimensions, and image provenance.
- [Resins](resins/README.md) contains resin names, categories, densities, product images, and provenance.
- [Filaments](filaments/README.md) contains filament products, materials, colours, and provenance, from SpoolmanDB.
- [Electricity](electricity/README.md) contains household electricity price snapshots by country.
- [Equipment](equipment/README.md) contains accessory and post-processing power specifications.
- [Parts](parts/README.md) contains wear parts with the printers they fit, sourced lifespans, manufacturer list prices on a checked date, and product images.
- [Supplies](supplies/README.md) contains wash fluids, gloves, and other supplies, the equipment their makers name them for, manufacturer list prices on a checked date, and product images.
- [App logos](app-logos/README.md) contains the official icons of the slicers and integrations STL Quest opens or connects to, and their provenance.

Run `pnpm catalog:sync` to regenerate the committed snapshots and `pnpm catalog:check` to validate all catalogs without network access.
