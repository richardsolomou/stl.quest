# Wear part catalog

STL Quest includes a hand-curated catalog of printer wear parts: resin tanks, release films including ACF and pulsing-release films, LCD screens and their protectors, flexible build platforms and print surfaces, nozzles and hotends, build sheets, air filters, belts, purge wipers and nozzle wiping pads, filament cutters, and PTFE tubes. Wash fluids such as IPA are supplies used by equipment, so they are in the [supply catalog](../supplies/README.md) instead. The app costs each part across the plates or print hours it lasts. Self-hosted installations read it locally and do not contact third-party services while the app is running.

`catalog.json` records each part, the printer presets it fits from the [printer catalog](../printers/README.md), and where every figure came from. A part with no fitted printers is generic and suits every printer of its print type. `sources` lists the manufacturer stores and support sites used and the date they were checked.

## Prices

`listPrice` is the manufacturer's own store price for one pack on the `checked` date, in that store's currency, with `packSize` when the pack holds several parts. Its note records whether tax is included and any sale. It is a starting point, not what a user pays: prices vary by region, retailer, and date, and users save their own price.

## Categories and sets

Each part has a `category`. The "What you need" list treats parts of one category for the same printers as alternatives, so owning a smooth or a satin sheet stands in for the other. A model that needs two parts of one category at once gives each its own `set`, such as the A2L's separate X and Y belts, so owning one still suggests the other.

## Lifespans

Each `lifespanSource` records its `basis`:

- `stated`: the manufacturer's own figure in plates or hours, such as Formlabs' resin tank lifetimes and the LCD hours Elegoo and Phrozen state on a product page.
- `derived`: a manufacturer's layer or release count converted to plates with the catalog's `layersPerPlate` assumption (1,000 layers, a 50 mm plate at 50 µm).
- `typical`: STL Quest's labelled estimate where the manufacturer states none. Its note gives the basis, such as another manufacturer's figure for a comparable part or a rounded order-of-magnitude starting point. The categories no manufacturer gives an interval for use these starting points:
  - nozzles and hotends 500 print hours, and HeyGears LCD screens 2,000 print hours, as Elegoo and Phrozen rate theirs;
  - Bambu Lab belts 5,000 print hours, purge wipers 2,000, wiping pads 500, and PTFE tubes 2,000;
  - filament cutters 500 print hours, from Bambu Lab's 10 to 15 spools at about 50 print hours a 1 kg spool;
  - ACF films 30 plates, from Anycubic's 30,000-layer FEP figure, and HeyGears films 45 plates, from its 45,000-layer figure for the Reflex's film, except the pulsing-release film at 150 plates, since the pulsing module peels each layer more gently;
  - screen protectors 200 plates, and flexible build platforms and print surfaces 500 plates, except the Form Studio 1 Build Platform Flex at 1,000 plates from use.

Manufacturers mostly replace wear parts on condition rather than on a schedule, so every lifespan is a planning figure that users can override.

## Coverage gaps

These were not catalogued because no reliable manufacturer price or lifespan basis was found on the checked date:

- Rigid build platforms (Formlabs, Elegoo, Phrozen, HeyGears), which have no meaningful wear life; flexible platforms and print surfaces are listed.
- Anycubic LCD screens, which state no lifespan.
- HeyGears resin tanks, whose release film is the wearing part and is listed on its own. HeyGears sells parts directly only in its US store; its EU retailers listed them as sold out on the checked date.
- Phrozen ACF films, whose listings name a series rather than the printers they fit, and the Sonic Mini 8K screen protector, whose listing names another series.
- Creality K1 and Ender nozzles, whose official listings were out of stock or listed inconsistent compatibility.
- The Bambu Lab H2D Pro's own wear parts beyond its air filter, since Bambu Lab's store does not list it among the H2 parts' printers.

`pnpm catalog:check` validates the catalog without using the network: unique `part-<slug>` IDs, fitted printers that exist with a matching print type, known categories, positive lifespans consistent with any stated layer count, prices in cents with ISO 4217 currency codes, and https sources.
