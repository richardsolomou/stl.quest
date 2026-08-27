# Electricity price catalog

STL Quest includes a local snapshot of household electricity prices from Eurostat dataset `nrg_pc_204` and the public selection in the IEA End-Use Prices Data Explorer. The Eurostat values use the medium household consumption band (2,500–4,999 kWh per year), prices in euros per kWh, and all taxes and levies included. IEA residential values are converted from US dollars per MWh to euros per kWh with the ECB annual average USD/EUR exchange rate for the same year.

Eurostat is preferred where both sources cover a country. The snapshot is a rough regional default, not a quote for a user's tariff, and users can override the resulting value.

`sources.json` pins the reference periods and exact API queries. Run `pnpm catalog:sync` to refresh the committed snapshot from those queries and `pnpm catalog:check` to validate it without network access.

Sources: Eurostat dataset `nrg_pc_204`, the IEA End-Use Prices Data Explorer, and ECB reference exchange rates, accessed 27 August 2026. STL Quest selects, converts, and reformats the relevant observations; the source organisations are not responsible for this adaptation.
