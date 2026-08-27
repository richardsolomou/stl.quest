import { describe, expect, it } from 'vitest'
import { mergeElectricityPrices, parseEcbUsdPerEur, parseEurostatElectricityPrices, parseIeaElectricityPrices } from './electricityCatalog'

describe('electricity catalog synchronization', () => {
  it('extracts country prices for the pinned period and excludes aggregates', () => {
    const response = {
      id: ['freq', 'geo', 'time'],
      size: [1, 3, 2],
      value: { '0': 0.2, '1': 0.21, '2': 0.3, '3': 0.31, '4': 0.4, '5': 0.41 },
      status: { '3': 'p' },
      dimension: {
        geo: {
          category: {
            index: { EU27_2020: 0, CY: 1, MT: 2 },
            label: { EU27_2020: 'European Union', CY: 'Cyprus', MT: 'Malta' },
          },
        },
        time: { category: { index: { '2025-S1': 0, '2025-S2': 1 } } },
      },
    }

    expect(parseEurostatElectricityPrices(response, source())).toEqual([
      {
        countryCode: 'CY',
        countryName: 'Cyprus',
        eurPerKwh: 0.31,
        period: '2025-S2',
        status: 'p',
        source: { id: 'eurostat-nrg-pc-204', url: 'https://example.com' },
      },
      {
        countryCode: 'MT',
        countryName: 'Malta',
        eurPerKwh: 0.41,
        period: '2025-S2',
        source: { id: 'eurostat-nrg-pc-204', url: 'https://example.com' },
      },
    ])
  })

  it('converts global IEA residential prices to euros and excludes aggregates', () => {
    const presets = parseIeaElectricityPrices(
      [
        { CODE_COUNTRY: 'USA', CODE_YEAR: '2025', Country: 'United States', Unit: 'USD/MWh', Value: 169.5 },
        { CODE_COUNTRY: 'WORLD', CODE_YEAR: '2025', Country: 'World', Unit: 'USD/MWh', Value: 150 },
      ],
      { ...source(), id: 'iea-end-use-prices', period: '2025' },
      1.13,
    )

    expect(presets).toEqual([
      {
        countryCode: 'US',
        countryName: 'United States',
        eurPerKwh: 0.15,
        period: '2025',
        source: { id: 'iea-end-use-prices', url: 'https://example.com' },
      },
    ])
  })

  it('keeps Eurostat as the preferred source when catalogs overlap', () => {
    const eurostat = [{ countryCode: 'DE', countryName: 'Germany', eurPerKwh: 0.3, period: '2025-S2', source: source() }]
    const iea = [
      { countryCode: 'DE', countryName: 'Germany', eurPerKwh: 0.4, period: '2025', source: source() },
      { countryCode: 'US', countryName: 'United States', eurPerKwh: 0.15, period: '2025', source: source() },
    ]

    expect(mergeElectricityPrices(eurostat, iea)).toEqual([eurostat[0], iea[1]])
  })

  it('reads the pinned annual USD to EUR exchange rate', () => {
    expect(parseEcbUsdPerEur('TIME_PERIOD,OBS_VALUE\n2025,1.13\n', '2025')).toBe(1.13)
  })
})

function source() {
  return {
    id: 'eurostat-nrg-pc-204',
    dataset: 'nrg_pc_204',
    period: '2025-S2',
    url: 'https://example.com',
    accessedAt: '2026-08-27',
  }
}
