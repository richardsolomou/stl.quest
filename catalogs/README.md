# Catalogs

STL Quest keeps versioned product data under this directory so self-hosted installations do not need external catalog services at runtime.

- [Printers](printers/README.md) contains printer models, dimensions, and image provenance.
- [Resins](resins/README.md) contains resin names, categories, densities, and provenance.
- [Electricity](electricity/README.md) contains household electricity price snapshots by country.
- [Equipment](equipment/README.md) contains accessory and post-processing power specifications.

Run `pnpm catalog:sync` to regenerate the committed snapshots and `pnpm catalog:check` to validate all catalogs without network access.
