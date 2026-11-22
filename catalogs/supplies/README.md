# Supply catalog

STL Quest includes a hand-curated catalog of supplies used up around printing: wash fluids, gloves, paper towels, resin filter funnels, build-plate cleaners and adhesives, desiccants, and lubricants. Picking one adds it to the library under its unit and pack size, and the user enters what they pay. Self-hosted installations read it locally and do not contact third-party services while the app is running.

`catalog.json` records each supply, the unit it is measured in (`ml`, `g`, or `item`), and whether only resin or only filament printing uses it. `sources` lists the manufacturer stores used and the date they were checked.

## Prices

`listPrice` is the manufacturer's own store price for one pack on the `checked` date, in that store's currency, with the pack's contents in `packSize`, in the supply's unit. Its note records whether tax is included and any sale. A supply no printer maker sells, such as IPA, TPM, nitrile gloves, paper towels, or paper filter funnels, has no brand and no price, only a `note` saying so; the catalog never invents a price for it.

## Images

`images.json` records the manufacturer's product image for each branded supply: the store page it came from, the exact image URL, and the date it was checked. A generic supply such as IPA or nitrile gloves has no single product to picture and shows an icon instead. Images are resized to fit 256 pixels, converted to WebP, and committed under `public/supply-presets/`, so the application reads only local files.

To add an image, add its `presetId`, `sourcePageUrl`, and `sourceUrl` to `images.json` and run `tsx scripts/updateCatalogImages.ts`, which downloads only images without a committed file; remove an image's `checkedAt` to replace it, or run `pnpm catalog:update-images` to download all of them again. A refresh keeps the committed file of any image whose source fails and lists it. `pnpm catalog:check` verifies that every image belongs to a catalogue entry, cites HTTPS sources, and has its committed file.

## Equipment

`usedBy` lists the [equipment presets](../equipment/README.md) whose maker names the supply, and `usedBySource` cites that maker's page. Formlabs names IPA, TPM, and its Resin Washing Solution for the Form Studio Wash+Cure, and recommends Resin Washing Solution for the Form Wash and Form Wash L. The supply picker lists these first for a workspace that owns the equipment, and the equipment editor offers them first and names any the library lacks.

`pnpm catalog:check` validates the catalog without using the network: unique `supply-<slug>` IDs, known categories, units, and print types, equipment presets that exist with an https source, list prices in cents with ISO 4217 currency codes and a pack size for anything sold by volume or weight, and a note on every supply without a price.
