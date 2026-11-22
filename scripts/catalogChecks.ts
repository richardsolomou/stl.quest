const currencies = new Set(Intl.supportedValuesOf('currency'))
const today = new Date().toISOString().slice(0, 10)

export function isHttps(url: string | undefined) {
  return url !== undefined && URL.canParse(url) && new URL(url).protocol === 'https:'
}

/** The problem with a catalogue list price, if any: cents, an ISO 4217 currency, an https page, and a past checked date. */
export function listPriceProblem(price: { amount: number; currency: string; url: string; checked: string }) {
  if (!Number.isFinite(price.amount) || price.amount <= 0 || Math.abs(price.amount * 100 - Math.round(price.amount * 100)) > 1e-6)
    return 'list price must be a positive amount in cents'
  if (!currencies.has(price.currency)) return `unknown ISO 4217 currency ${price.currency}`
  if (!isHttps(price.url)) return 'invalid list price URL'
  if (!/^\d{4}-\d{2}-\d{2}$/.test(price.checked) || Number.isNaN(Date.parse(price.checked)) || price.checked > today)
    return 'list price checked date must be a past YYYY-MM-DD date'
  return undefined
}
