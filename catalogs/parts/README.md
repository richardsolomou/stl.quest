# Wear part catalog

STL Quest includes a hand-curated catalog of printer wear parts: resin tanks, release films, LCD screens, nozzles and hotends, and build sheets. Wash fluids such as IPA are supplies used by equipment, not wear parts, so they are not listed here. The app costs each part across the plates or print hours it lasts. Self-hosted installations read it locally and do not contact third-party services while the app is running.

`catalog.json` records each part, the printer presets it fits from the [printer catalog](../printers/README.md), and where every figure came from. A part with no fitted printers is generic and suits every printer of its print type. `sources` lists the manufacturer stores and support sites used and the date they were checked.

## Prices

`listPrice` is the manufacturer's own store price for one pack on the `checked` date, in that store's currency, with `packSize` when the pack holds several parts. Its note records whether tax is included and any sale. It is a starting point, not what a user pays: prices vary by region, retailer, and date, and users save their own price.

## Lifespans

Each `lifespanSource` records its `basis`:

- `stated`: the manufacturer's own figure in plates or hours, such as Formlabs' resin tank lifetimes and the LCD hours Elegoo and Phrozen state on a product page.
- `derived`: a manufacturer's layer or release count converted to plates with the catalog's `layersPerPlate` assumption (1,000 layers, a 50 mm plate at 50 µm).
- `typical`: STL Quest's labelled estimate where the manufacturer states none. Its note gives the basis, such as another manufacturer's figure for a comparable part or a rounded order-of-magnitude starting point.

Manufacturers mostly replace wear parts on condition rather than on a schedule, so every lifespan is a planning figure that users can override.

## Coverage gaps

These were not catalogued because no reliable manufacturer price or lifespan basis was found on the checked date:

- Build platforms (Formlabs, Elegoo, Phrozen), which have no meaningful wear life.
- ACF release films, for which no manufacturer states a lifespan comparable to FEP.
- Anycubic LCD screens, which state no lifespan.
- Creality K1 and Ender nozzles, whose official listings were out of stock or listed inconsistent compatibility.

`pnpm catalog:check` validates the catalog without using the network: unique `part-<slug>` IDs, fitted printers that exist with a matching print type, positive lifespans consistent with any stated layer count, prices in cents with ISO 4217 currency codes, and https sources.
