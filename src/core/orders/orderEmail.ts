import type { PriceCalculatorCurrency } from '../priceCalculator'
import { bambuLabOrder } from './bambuLab'
import { orderEmailLines } from './orderText'

/**
 * Reading what arrived from a pasted order confirmation email. Parsing runs wherever the email is pasted, in the
 * browser, so the email itself is never sent or stored: only the restocks someone confirms from it are.
 */

export const ORDER_VENDORS = ['bambu-lab'] as const
export type OrderVendor = (typeof ORDER_VENDORS)[number]

/** One product line of an order, as the email states it. */
export type OrderLine = {
  /** The product's title, such as "PLA Basic". */
  product: string
  /** The colour's name and the shop's code for it, such as Gray and 10103. */
  colour?: { name: string; code?: string }
  /** A refill comes without a reusable spool; a spool comes on one. */
  form?: 'refill' | 'spool'
  /** What one unit holds, when the line says. */
  grams?: number
  quantity: number
  /** What the whole line cost, as the email states it. */
  linePrice?: number
}

export type ParsedOrder = {
  vendor: OrderVendor
  currency?: PriceCalculatorCurrency
  lines: OrderLine[]
}

/** One shop's order emails: whether a pasted email is one, and its product lines. */
export type OrderParser = {
  vendor: OrderVendor
  recognises: (lines: string[]) => boolean
  parse: (lines: string[]) => Omit<ParsedOrder, 'vendor'>
}

/** Every shop whose emails can be read, tried in order; another shop is one more parser here. */
export const ORDER_PARSERS: readonly OrderParser[] = [bambuLabOrder]

/** The order a pasted email holds, or undefined when no shop's parser recognises it or it lists nothing it can read. */
export function parseOrderEmail(pasted: string, parsers: readonly OrderParser[] = ORDER_PARSERS): ParsedOrder | undefined {
  const lines = orderEmailLines(pasted)
  for (const parser of parsers) {
    if (!parser.recognises(lines)) continue
    const order = parser.parse(lines)
    if (order.lines.length) return { vendor: parser.vendor, ...order }
  }
  return undefined
}
