export type ElectricityCatalogSource = {
  id: string
  dataset: string
  period: string
  url: string
  accessedAt: string
}

export type ElectricityPricePreset = {
  countryCode: string
  countryName: string
  eurPerKwh: number
  period: string
  status?: string
  source: { id: string; url: string }
}

type EurostatResponse = {
  id: string[]
  size: number[]
  value: Record<string, number>
  status?: Record<string, string>
  dimension: {
    geo: { category: { index: Record<string, number>; label: Record<string, string> } }
    time: { category: { index: Record<string, number> } }
  }
}

type IeaPrice = {
  CODE_COUNTRY: string
  CODE_YEAR: string
  Country: string
  Unit: string
  Value: number
}

const ieaCountryCodes: Record<string, string> = {
  ALGERIA: 'DZ',
  ARMENIA: 'AM',
  BELARUS: 'BY',
  CHINA: 'CN',
  COTEIVOIRE: 'CI',
  ECUADOR: 'EC',
  EGYPT: 'EG',
  GEORGIA: 'GE',
  GERMANY: 'DE',
  INDIA: 'IN',
  KENYA: 'KE',
  MCABOVERDE: 'CV',
  MCHAD: 'TD',
  NEPAL: 'NP',
  NICARAGUA: 'NI',
  PHILIPPINE: 'PH',
  RUSSIA: 'RU',
  SENEGAL: 'SN',
  SINGAPORE: 'SG',
  UKRAINE: 'UA',
  URUGUAY: 'UY',
  USA: 'US',
  UZBEKISTAN: 'UZ',
  VIETNAM: 'VN',
}

export function parseEurostatElectricityPrices(response: EurostatResponse, source: ElectricityCatalogSource) {
  const geoDimension = response.id.indexOf('geo')
  const timeDimension = response.id.indexOf('time')
  if (geoDimension < 0 || timeDimension < 0) throw new Error('Eurostat response is missing geo or time dimensions')
  const periodIndex = response.dimension.time.category.index[source.period]
  if (periodIndex === undefined) throw new Error(`Eurostat response does not include ${source.period}`)
  const aggregates = new Set(['EU27_2020', 'EA'])
  const presets: ElectricityPricePreset[] = []
  for (const [countryCode, geoIndex] of Object.entries(response.dimension.geo.category.index)) {
    if (aggregates.has(countryCode)) continue
    const valueIndex = flatIndex(response.size, { [geoDimension]: geoIndex, [timeDimension]: periodIndex })
    const eurPerKwh = response.value[String(valueIndex)]
    if (!Number.isFinite(eurPerKwh)) continue
    presets.push({
      countryCode: normalizeCountryCode(countryCode),
      countryName: response.dimension.geo.category.label[countryCode],
      eurPerKwh,
      period: source.period,
      ...(response.status?.[String(valueIndex)] ? { status: response.status[String(valueIndex)] } : {}),
      source: { id: source.id, url: source.url },
    })
  }
  return presets.sort((first, second) => first.countryName.localeCompare(second.countryName))
}

export function parseIeaElectricityPrices(response: IeaPrice[], source: ElectricityCatalogSource, usdPerEur: number) {
  if (!Number.isFinite(usdPerEur) || usdPerEur <= 0) throw new Error('ECB USD/EUR exchange rate is invalid')
  return response
    .flatMap((item): ElectricityPricePreset[] => {
      const countryCode = ieaCountryCodes[item.CODE_COUNTRY]
      if (!countryCode || item.CODE_YEAR !== source.period || item.Unit !== 'USD/MWh' || !Number.isFinite(item.Value) || item.Value <= 0)
        return []
      return [
        {
          countryCode,
          countryName: normalizeCountryName(item.Country),
          eurPerKwh: roundPrice(item.Value / usdPerEur / 1_000),
          period: source.period,
          source: { id: source.id, url: source.url },
        },
      ]
    })
    .sort((first, second) => first.countryName.localeCompare(second.countryName))
}

export function mergeElectricityPrices(primary: ElectricityPricePreset[], fallback: ElectricityPricePreset[]) {
  const presets = new Map(fallback.map((preset) => [preset.countryCode, preset]))
  for (const preset of primary) presets.set(preset.countryCode, preset)
  return [...presets.values()].sort((first, second) => first.countryName.localeCompare(second.countryName))
}

export function parseEcbUsdPerEur(csv: string, period: string) {
  const [header, ...rows] = csv.trim().split(/\r?\n/)
  const columns = header?.split(',') ?? []
  const periodIndex = columns.indexOf('TIME_PERIOD')
  const valueIndex = columns.indexOf('OBS_VALUE')
  if (periodIndex < 0 || valueIndex < 0) throw new Error('ECB response is missing TIME_PERIOD or OBS_VALUE')
  const row = rows.map((candidate) => candidate.split(',')).find((candidate) => candidate[periodIndex] === period)
  const value = Number(row?.[valueIndex])
  if (!Number.isFinite(value) || value <= 0) throw new Error(`ECB response does not include a valid USD/EUR rate for ${period}`)
  return value
}

function flatIndex(sizes: number[], coordinates: Record<number, number>) {
  let index = 0
  for (let dimension = 0; dimension < sizes.length; dimension += 1) index = index * sizes[dimension] + (coordinates[dimension] ?? 0)
  return index
}

function normalizeCountryCode(countryCode: string) {
  if (countryCode === 'EL') return 'GR'
  if (countryCode === 'UK') return 'GB'
  return countryCode
}

function normalizeCountryName(countryName: string) {
  if (countryName === "People's Republic of China") return 'China'
  if (countryName === 'Russian Federation') return 'Russia'
  if (countryName === 'Viet Nam') return 'Vietnam'
  return countryName
}

function roundPrice(value: number) {
  return Math.round(value * 1_000_000) / 1_000_000
}
