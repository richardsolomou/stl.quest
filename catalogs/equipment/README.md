# Equipment power catalog

The calculator gets its printer names and print types from STL Quest's main printer catalog. This supplemental catalog records official power specifications for printers where they are available and provides separate resin and FDM accessory lists. Each entry records its printing, washing, drying, or curing power profiles and the source page used. One device can have several profiles when it performs several phases.

Official product stores and manuals are the discovery and verification sources. The catalog is a versioned snapshot rather than a runtime dependency because manufacturers frequently move pages and publish specifications as HTML or PDFs instead of a stable API.

Power specifications are conservative estimates rather than measured energy consumption. Where a manufacturer publishes only LED power for a heated curing unit, the basis says that the heater draw is missing. A rated or adapter-input figure can be higher than real draw, while heaters can cycle. Where a manufacturer publishes measured average or typical printing power, the catalog uses it instead of a rated or peak figure, which mostly reflects a heater warming up, and records the material, test condition, or published range in the basis. Printers without a published profile use a process-specific default estimate. Zero-power feeding accessories are powered by the selected printer, while dryer power is recorded as a separate phase. Users can override every calculated phase total and duration in their saved setup.

## Images

`images.json` records an official manufacturer product image for each catalogue station, dryer, and printer add-on that has one: the product page it came from, the exact image URL, and the date it was checked. Images come only from the manufacturer's own store or product page, chosen by hand to show the product alone without sale badges or marketing overlays; where only a kit is sold, as with Phrozen's Wash & Cure Kit and Elegoo's Mercury XS Bundle, the image is the kit's photo of that unit. Like the printer catalog's manufacturer images, they are resized to fit 256 pixels, converted to WebP, and committed under `public/equipment-presets/`, so the application reads only local files.

Run `pnpm catalog:update-images` to download every recorded image again; it also runs as part of `pnpm catalog:update`. To add or replace an image, edit its `sourcePageUrl` and `sourceUrl` in `images.json` and run `tsx scripts/updateEquipmentImages.ts`. `pnpm catalog:check` verifies that every image belongs to a catalogue entry, cites HTTPS sources, and has its committed file.

Printer entries carry no image here because the app shows them through the printer catalog. These entries have no image because the manufacturer no longer publishes one for that model:

- Bambu Lab AMS, which the Bambu Lab store no longer lists.
- UniFormation Cure2, which UniFormation's store no longer lists.
- Formlabs Form Wash L V1, Form Cure V1, and Form Cure L V1, because Formlabs' product pages show only the current generation.
