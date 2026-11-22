import { PRICE_CALCULATOR_CURRENCIES, type PriceCalculatorCurrency } from '../priceCalculator'

/** A pasted email this long is refused before it is read; order confirmations are far smaller. */
export const MAX_ORDER_EMAIL_LENGTH = 500_000

const BLOCK_TAGS =
  /<\s*(?:br|\/?(?:p|div|tr|td|th|li|ul|ol|table|tbody|thead|h[1-6]|section|article|header|footer|center|blockquote))\b[^>]*>/gi
const ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  euro: '€',
  pound: '£',
  times: '×',
  ndash: '–',
  mdash: '—',
  middot: '·',
  shy: '',
  zwnj: '',
  copy: '©',
}

// Built from a string, since a formatter would turn the escapes into invisible characters.
const ZERO_WIDTH = new RegExp(String.raw`[\u200B-\u200D\uFEFF]`, 'g')

/**
 * The text of a pasted email, one trimmed line each, empty lines dropped. Copying a message from a mail app gives
 * plain text; pasting its source gives HTML, possibly quoted-printable, which is reduced to the text it shows.
 */
export function orderEmailLines(pasted: string) {
  let text = pasted.slice(0, MAX_ORDER_EMAIL_LENGTH)
  if (/=\r?\n|=3D|=E2=82=AC/i.test(text)) text = decodeQuotedPrintable(text)
  if (/<\/?(?:html|body|table|div|td|p|br|span)\b/i.test(text)) text = htmlText(text)
  return text
    .split(/\r?\n/)
    .map((line) => line.replaceAll(ZERO_WIDTH, '').replace(/\s+/g, ' ').trim())
    .filter(Boolean)
}

/** The text an HTML email shows. Its output is only ever plain text, and each strip repeats so nested markup cannot survive. */
function htmlText(html: string) {
  const stripped = untilStable(html, (text) =>
    text.replace(/<!--[\s\S]*?-->/g, '').replace(/<(head|style|script|title)\b[\s\S]*?<\/\1\s*>/gi, ''),
  )
  const lines = stripped.replace(/\r?\n/g, ' ').replace(BLOCK_TAGS, '\n')
  return decodeEntities(untilStable(lines, (text) => text.replace(/<[^>]*>/g, '')).replace(/[<>]/g, ''))
}

function untilStable(text: string, strip: (text: string) => string) {
  for (let previous = ''; previous !== text;) [previous, text] = [text, strip(text)]
  return text
}

function decodeEntities(text: string) {
  return text.replace(/&(#x[\da-f]+|#\d+|[a-z]+);/gi, (entity, name: string) => {
    if (name[0] === '#') {
      const code = name[1].toLowerCase() === 'x' ? Number.parseInt(name.slice(2), 16) : Number(name.slice(1))
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : ''
    }
    return ENTITIES[name.toLowerCase()] ?? entity
  })
}

/** Quoted-printable bytes decoded as UTF-8, with soft line breaks joined. */
function decodeQuotedPrintable(text: string) {
  const joined = text.replace(/=\r?\n/g, '')
  const bytes: number[] = []
  for (let index = 0; index < joined.length; index += 1) {
    const hex = joined[index] === '=' ? joined.slice(index + 1, index + 3) : ''
    if (/^[\da-f]{2}$/i.test(hex)) {
      bytes.push(Number.parseInt(hex, 16))
      index += 2
    } else {
      bytes.push(...new TextEncoder().encode(joined[index]))
    }
  }
  return new TextDecoder().decode(new Uint8Array(bytes))
}

export type Money = { amount: number; currency?: PriceCalculatorCurrency }

const SYMBOLS: [RegExp, PriceCalculatorCurrency][] = [
  [/€/, 'EUR'],
  [/£/, 'GBP'],
  [/CHF/, 'CHF'],
  [/zł/i, 'PLN'],
  [/Kč/, 'CZK'],
  [/C\$|CA\$/, 'CAD'],
  [/A\$|AU\$/, 'AUD'],
  [/NZ\$/, 'NZD'],
  [/US\$|\$/, 'USD'],
  [/¥/, 'JPY'],
]
const CODES = PRICE_CALCULATOR_CURRENCIES.join('|')
const NUMBER = String.raw`\d{1,3}(?:[ .,']\d{3})*(?:[.,]\d{1,2})?|\d+(?:[.,]\d{1,2})?`
const SIGN = String.raw`(?:${CODES}|[€£$¥]|CHF|zł|Kč|[A-Z]{1,2}\$)`
const MONEY = new RegExp(
  String.raw`(-?)\s*(${SIGN})\s?(${NUMBER})(?:\s?(${CODES})\b)?|(-?)(${NUMBER})\s?(${SIGN})(?!\s?\d)(?:\s?(${CODES})\b)?`,
  'g',
)

/** Every amount of money a line states, in order, each with the currency its symbol or code names. */
export function moneyIn(line: string): Money[] {
  return [...line.matchAll(MONEY)].map((match) => {
    const [, signBefore, symbolBefore, numberBefore, codeBefore, signAfter, numberAfter, symbolAfter, codeAfter] = match
    const amount = parseAmount(numberBefore ?? numberAfter) * ((signBefore ?? signAfter) === '-' ? -1 : 1)
    const currency = currencyOf(codeBefore ?? codeAfter ?? symbolBefore ?? symbolAfter)
    return { amount, ...(currency && { currency }) }
  })
}

function currencyOf(sign: string): PriceCalculatorCurrency | undefined {
  const code = PRICE_CALCULATOR_CURRENCIES.find((currency) => currency === sign)
  return code ?? SYMBOLS.find(([symbol]) => symbol.test(sign))?.[1]
}

/** `1.234,56`, `1,234.56`, `12,99`, and `12.99` alike: the last separator followed by one or two digits is the decimal point. */
function parseAmount(text: string) {
  const decimal = /[.,](\d{1,2})$/.exec(text)
  const whole = (decimal ? text.slice(0, -decimal[0].length) : text).replace(/\D/g, '')
  return Number(`${whole || '0'}.${decimal?.[1] ?? '0'}`)
}

/** Text compared without case, accents, punctuation, or the British and American spellings of grey. */
export function normalizedWords(text: string) {
  return text
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/\bgrey\b/g, 'gray')
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean)
}
