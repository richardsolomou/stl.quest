# Equipment power catalog

The calculator gets its printer names and print types from STL Quest's main 541-model printer catalog. This supplemental catalog records official power specifications for printers where they are available and provides separate resin and FDM accessory lists. Each entry records its printing, washing, drying, or curing power profiles and the source page used. One device can have several profiles when it performs several phases.

Official product stores and manuals are the discovery and verification sources. The catalog is a versioned snapshot rather than a runtime dependency because manufacturers frequently move pages and publish specifications as HTML or PDFs instead of a stable API.

Power specifications are conservative estimates rather than measured energy consumption. A rated or adapter-input figure can be higher than real draw, while heaters can cycle. Where a manufacturer publishes measured average printing power, the catalog uses it and records the material or test condition in the basis. Printers without a published profile use a process-specific default estimate. Zero-power feeding accessories are powered by the selected printer, while dryer power is recorded as a separate phase. Users can override every calculated phase total and duration in their saved setup.
