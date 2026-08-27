# Third-party notices

STL Quest is licensed under the GNU Affero General Public License v3.0 as described in [`LICENSE`](LICENSE). The notices and license texts below cover bundled third-party material and remain applicable independently.

## Realtime runtime

The container image bundles [Centrifugo](https://github.com/centrifugal/centrifugo) 6.9.1 and [Caddy](https://github.com/caddyserver/caddy) 2.11.4. Both are licensed under Apache-2.0; the license text is included in `LICENSES/Apache-2.0.txt`.

## Printer catalog

Filament printer definitions and cover images under `catalogs/printers/catalog.generated.json` and `public/printer-presets/orcaslicer/` are derived from [OrcaSlicer](https://github.com/OrcaSlicer/OrcaSlicer). Resin printer definitions are primarily derived from [UVtools](https://github.com/sn4k3/UVtools). Their pinned revisions are recorded in `catalogs/printers/sources.json`.

Supplemental resin definitions and images are derived from the pinned [Open Resin Alliance](https://github.com/Open-Resin-Alliance) Elegoo, Anycubic, and Uniformation plugins. Prusa resin thumbnails are derived from [PrusaSlicer](https://github.com/prusa3d/PrusaSlicer). Their pinned revisions and source paths are recorded in `catalogs/printers/image-sources.json`.

HeyGears printer definitions, build volumes, and product images are synchronized from its official storefront. Selected Phrozen images are synchronized from exact official product pages. Manufacturer names, product data, and product images remain the property of their respective owners.

Every synchronized manufacturer image records its source page and original image URL in `catalogs/printers/manufacturer-images.json`. The generated catalog and images are committed so installed applications do not contact these services at runtime.

The Open Resin Alliance printer plugin images are licensed under MIT. Their license texts are included in `LICENSES/Open-Resin-Alliance-df-plugin-elegoo-MIT.txt`, `LICENSES/Open-Resin-Alliance-df-plugin-anycubic-MIT.txt`, and `LICENSES/Open-Resin-Alliance-df-plugin-uniformation-MIT.txt`.

OrcaSlicer, UVtools, and PrusaSlicer content is licensed under AGPL-3.0-only. Their license texts are included in `LICENSES/OrcaSlicer-AGPL-3.0.txt`, `LICENSES/UVtools-AGPL-3.0.txt`, and `LICENSES/PrusaSlicer-AGPL-3.0.txt`.

## Resin catalog

Resin names, categories, and available density values under `catalogs/resins/catalog.generated.json` are derived from pinned [PrusaSlicer](https://github.com/prusa3d/PrusaSlicer) SLA material profiles and selected official HeyGears material pages. Their revisions and exact source URLs are recorded alongside the generated presets. PrusaSlicer content is licensed under AGPL-3.0-only; manufacturer names and product data remain the property of their respective owners.

## Electricity price catalog

Country electricity averages under `catalogs/electricity/catalog.generated.json` are adapted from Eurostat dataset `nrg_pc_204`, accessed 27 August 2026. Reuse of Eurostat statistical data is authorised with source acknowledgement under the [Eurostat copyright and reuse policy](https://ec.europa.eu/eurostat/help/copyright-notice). Eurostat is not responsible for STL Quest's selection, presentation, or use of the data.

Additional country averages are adapted from the public selection in the [IEA End-Use Prices Data Explorer](https://www.iea.org/data-and-statistics/data-tools/end-use-prices-data-explorer), accessed 27 August 2026 and licensed under [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). IEA values are converted from US dollars per MWh to euros per kWh with the ECB annual average USD/EUR reference exchange rate for the same year.

The exchange-rate observation is sourced from the [ECB Data Portal](https://data.ecb.europa.eu/data/datasets/EXR/EXR.A.USD.EUR.SP00.A). Reuse is permitted under the [ECB copyright and reuse policy](https://www.ecb.europa.eu/stats/ecb_statistics/governance_and_quality_framework/html/usage_policy.en.html). The ECB is not responsible for STL Quest's transformation or use of the data.

## Equipment power catalog

Equipment names and power specifications under `catalogs/equipment/catalog.json` are curated from the official manufacturer pages recorded with each preset. Manufacturer names, trademarks, and product data remain the property of their respective owners.
