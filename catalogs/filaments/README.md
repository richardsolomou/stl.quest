# Filament catalog

STL Quest includes a generated filament catalog so a workspace adds the filaments it buys by product and colour instead of typing names. Self-hosted installations read it locally and do not contact third-party services while the app is running.

The catalog is a slim copy of [SpoolmanDB](https://github.com/Donkie/SpoolmanDB), the community filament database behind Spoolman, pinned to the revision in `sources.json`. SpoolmanDB lists each product once per spool size and diameter under a name template such as `Matte {color_name}`; the generator folds those into one product per line and material ("Matte PLA", or just "ePLA+HS" when the line already names the material) and keeps its material, density, and every colour's name and hex value. Spool sizes, diameters, and temperatures are left out because pricing does not use them. A manufacturer sometimes lists several products under one template, such as Bambu Lab's basic, marble, and gradient `{color_name}` PLA; SpoolmanDB's `pattern`, `translucent`, `glow`, and `multi_color_direction` attributes then prefix the name ("Marble PLA", "Translucent PETG", "Gradient PLA", "Dual Color Silk PLA"), and the product with none of them keeps the plain name and ID. Products told apart only by density, such as Bambu Lab's ASA and ASA Aero, stay merged. SpoolmanDB carries no manufacturer colour codes, such as the Bambu Lab codes printed on receipts and AMS tags, so the catalog has none either.

`overrides.json` patches a generated product's name by ID, where SpoolmanDB's name differs from the one the manufacturer sells it under, such as Bambu Lab's PLA Basic. A patch never changes the ID, since workspaces keep the ID of the product they chose.

Prices are deliberately excluded: SpoolmanDB carries none, and they vary by seller, region, spool size, and purchase date. Users choose a product and colour, then save their own price per kilogram.

Run `pnpm catalog:sync` to regenerate the catalog from the recorded revision, `pnpm catalog:update` to move to SpoolmanDB's current `main`, and `pnpm catalog:check` to validate the committed catalog without using the network.
