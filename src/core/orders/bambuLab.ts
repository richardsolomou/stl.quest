import type { OrderLine, OrderParser } from './orderEmail'
import { moneyIn } from './orderText'

/**
 * Bambu Lab store order confirmations list each filament as its product title ("PLA Basic × 2"), then its variant
 * ("Gray (10103) / Refill / 1 kg"), then the line's price, or all of it on one line ("PLA Basic - Gray (10103) / …").
 * The five-digit code after a colour name marks a filament line, so accessories and totals are left out.
 */
export const bambuLabOrder: OrderParser = {
  vendor: 'bambu-lab',
  recognises: (lines) => lines.some((line) => /bambu\s?lab/i.test(line)),
  parse: (lines) => {
    const anchors = lines.flatMap((line, index) => {
      const colour = colourSegment(line)
      return colour ? [{ index, ...colour }] : []
    })
    const items = anchors.flatMap((anchor, position) => {
      const titleIndex = anchor.before ? anchor.index : anchor.index - 1
      const title = anchor.before ?? (titleIndex >= 0 && isTitle(lines[titleIndex]) ? lines[titleIndex] : undefined)
      if (!title) return []
      const next = anchors[position + 1]
      const following = itemLines(lines, anchor.index + 1, next ? (next.before ? next.index : next.index - 1) : lines.length)
      const window = [...(titleIndex === anchor.index ? [] : [lines[titleIndex]]), lines[anchor.index], ...following]
      const details = [title, ...anchor.after, ...following.filter((line) => !moneyIn(line).length)].join(' ')
      const quantity = window.map(quantityIn).find((found) => found !== undefined) ?? 1
      const prices = window.flatMap((line) =>
        moneyIn(line).flatMap((money) => (money.amount > 0 ? [{ ...money, each: EACH.test(line) }] : [])),
      )
      const last = prices.at(-1)
      const linePrice = last && (last.each ? last.amount * quantity : last.amount)
      const grams = gramsIn(details)
      const form = formIn(details)
      const line: OrderLine = {
        product: productName(title),
        colour: { name: anchor.name, code: anchor.code },
        ...(form && { form }),
        ...(grams && { grams }),
        quantity,
        ...(linePrice !== undefined && { linePrice: Math.round(linePrice * 100) / 100 }),
      }
      return [{ line, currency: last?.currency }]
    })
    const currency = [...items, ...lines.flatMap((line) => moneyIn(line))].find((found) => found.currency)?.currency
    return { ...(currency && { currency }), lines: items.map(({ line }) => line) }
  },
}

const EACH = /\b(each|pro stück|chacun|l'unité|unit price|stückpreis|prix unitaire)\b/i

/**
 * The lines after a filament's colour that still describe it: they end at the next filament, the order's totals, or
 * another product's title, which is a title line with a quantity or one after the filament's price.
 */
function itemLines(lines: string[], from: number, to: number) {
  const found: string[] = []
  for (const line of lines.slice(from, to)) {
    if (TOTALS.test(line)) break
    if (isTitle(line) && (quantityIn(line) !== undefined || found.some((seen) => moneyIn(seen).length))) break
    found.push(line)
  }
  return found
}

const LABEL = /^(?:colou?r|farbe|couleur|farbton)\s*:\s*/i
const COLOUR = /^(\p{L}[\p{L}\p{M}'’&+. -]*?)\s*(?:\(\s*(\d{5})\s*\)|\[\s*(\d{5})\s*\]|(\d{5}))$/u

/** The segment of a line naming a colour and its code, with the segments before (the title) and after it. */
function colourSegment(line: string) {
  if (/#|order|bestell|commande/i.test(line) && !/\(\s*\d{5}\s*\)/.test(line)) return undefined
  const segments = line.split(/\s+[/|·–—-]\s+|\s*\/\s*|,\s+/)
  for (const [index, segment] of segments.entries()) {
    const match = COLOUR.exec(stripMoney(segment).replace(LABEL, '').trim())
    if (!match) continue
    const before = segments.slice(0, index).join(' ').trim()
    const after = segments.slice(index + 1)
    // A bare code could be a postcode, so it counts only beside a title or variant details.
    if (match[4] && !before && !after.length) continue
    return {
      name: match[1].trim(),
      code: match[2] ?? match[3] ?? match[4],
      ...(before && { before }),
      after,
    }
  }
  return undefined
}

/** A line that can be a product title: words, with no colour code and not only a price or a quantity. */
function isTitle(line: string) {
  const words = stripQuantity(stripMoney(line)).trim()
  return /\p{L}{2,}/u.test(words) && !colourSegment(line) && !TOTALS.test(line)
}

const TOTALS =
  /^(sub-?total|zwischensumme|sous-total|total|gesamt|summe|shipping|versand|livraison|expédition|tax(es)?|steuer|mwst|tva|vat|discount|rabatt|remise|réduction|payment|zahlung|paiement)\b/i

function quantityIn(line: string) {
  const match =
    /×\s*(\d{1,3})\b/.exec(line) ??
    /(?:^|\s)x\s?(\d{1,3})(?:\s|$)/i.exec(line) ??
    /\b(?:qty|quantity|menge|anzahl|quantité|qté)\s*[:.]?\s*(\d{1,3})\b/i.exec(line) ??
    /^(\d{1,3})\s*[×x]\s/i.exec(line)
  const quantity = match ? Number(match[1]) : undefined
  return quantity && quantity > 0 ? quantity : undefined
}

function gramsIn(text: string) {
  const match = /(\d+(?:[.,]\d+)?)\s*(kg|g)\b/i.exec(text)
  if (!match) return undefined
  const value = Number(match[1].replace(',', '.'))
  return Math.round(match[2].toLowerCase() === 'kg' ? value * 1_000 : value) || undefined
}

function formIn(text: string): OrderLine['form'] {
  if (/refill|nachfüll|recharge|\b(without|ohne|sans)\s+(spool|spule|bobine)/i.test(text)) return 'refill'
  if (/spool|spule|bobine/i.test(text)) return 'spool'
  return undefined
}

function productName(title: string) {
  return stripQuantity(stripMoney(title))
    .replace(/^bambu\s?lab\s+/i, '')
    .trim()
}

function stripMoney(text: string) {
  return text.replace(/-?\s*(?:[€£$¥]|CHF|EUR|USD|GBP)\s?\d[\d.,' ]*|\d[\d.,' ]*\s?(?:[€£$¥]|CHF|EUR|USD|GBP)/g, ' ')
}

function stripQuantity(text: string) {
  return text
    .replace(/\s*×\s*\d{1,3}\b/g, ' ')
    .replace(/(?:^|\s)x\s?\d{1,3}(?=\s|$)/gi, ' ')
    .replace(/\b(?:qty|quantity|menge|anzahl|quantité|qté)\s*[:.]?\s*\d{1,3}\b/gi, ' ')
    .replace(/\s+/g, ' ')
}
