# Filament catalog

STL Quest includes a generated filament catalog so a workspace adds the filaments it buys by product and colour instead of typing names. Self-hosted installations read it locally and do not contact third-party services while the app is running.

The catalog is a slim copy of [SpoolmanDB](https://github.com/Donkie/SpoolmanDB), the community filament database behind Spoolman, pinned to the revision in `sources.json`. SpoolmanDB lists each product once per spool size and diameter under a name template such as `Matte {color_name}`; the generator folds those into one product per line and material ("Matte PLA", or just "ePLA+HS" when the line already names the material) and keeps its material, density, and every colour's name and hex value. Spool sizes, diameters, and temperatures are left out because pricing does not use them.

Prices are deliberately excluded: SpoolmanDB carries none, and they vary by seller, region, spool size, and purchase date. Users choose a product and colour, then save their own price per kilogram.

Run `pnpm catalog:sync` to regenerate the catalog from the recorded revision, `pnpm catalog:update` to move to SpoolmanDB's current `main`, and `pnpm catalog:check` to validate the committed catalog without using the network.
