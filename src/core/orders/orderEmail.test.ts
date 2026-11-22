import { describe, expect, it } from 'vitest'
import { BAMBU_LAB_EU_GERMAN_TEXT, BAMBU_LAB_EU_HTML, BAMBU_LAB_EU_QUOTED_PRINTABLE, BAMBU_LAB_EU_TEXT } from './fixtures'
import { parseOrderEmail, type OrderParser } from './orderEmail'
import { moneyIn, orderEmailLines } from './orderText'

describe('parseOrderEmail', () => {
  it('reads each filament line of a Bambu Lab order copied as text', () => {
    expect(parseOrderEmail(BAMBU_LAB_EU_TEXT)?.lines).toEqual([
      { product: 'PLA Basic', colour: { name: 'Gray', code: '10103' }, form: 'refill', grams: 1_000, quantity: 2, linePrice: 33.98 },
      { product: 'PLA Matte', colour: { name: 'Charcoal', code: '11101' }, form: 'spool', grams: 1_000, quantity: 1, linePrice: 21.99 },
      { product: 'PETG HF', colour: { name: 'Black', code: '33102' }, form: 'refill', grams: 1_000, quantity: 3, linePrice: 59.97 },
    ])
  })

  it('names the shop the order came from', () => {
    expect(parseOrderEmail(BAMBU_LAB_EU_TEXT)?.vendor).toBe('bambu-lab')
  })

  it('takes the currency from the prices', () => {
    expect(parseOrderEmail(BAMBU_LAB_EU_TEXT)?.currency).toBe('EUR')
  })

  it('reads a German order with each line on one row and decimal commas', () => {
    expect(parseOrderEmail(BAMBU_LAB_EU_GERMAN_TEXT)?.lines).toEqual([
      { product: 'PLA Basic', colour: { name: 'Jade White', code: '10100' }, form: 'refill', grams: 1_000, quantity: 1, linePrice: 16.99 },
      { product: 'PLA Basic', colour: { name: 'Gray', code: '10103' }, form: 'spool', grams: 1_000, quantity: 2, linePrice: 39.98 },
    ])
  })

  it('reads the HTML source of an order, taking the price after a struck-out one', () => {
    expect(parseOrderEmail(BAMBU_LAB_EU_HTML)?.lines).toEqual([
      { product: 'PLA Basic', colour: { name: 'Bambu Green', code: '10501' }, form: 'refill', grams: 1_000, quantity: 4, linePrice: 67.96 },
      { product: 'PLA Silk+', colour: { name: 'Gold', code: '13405' }, form: 'spool', grams: 1_000, quantity: 1, linePrice: 24.99 },
    ])
  })

  it('reads quoted-printable HTML source', () => {
    expect(parseOrderEmail(BAMBU_LAB_EU_QUOTED_PRINTABLE)?.lines).toEqual([
      { product: 'PLA Basic', colour: { name: 'Gray', code: '10103' }, form: 'refill', grams: 1_000, quantity: 2, linePrice: 33.98 },
    ])
  })

  it('leaves out an accessory without a colour code', () => {
    expect(parseOrderEmail(BAMBU_LAB_EU_TEXT)?.lines.some(({ product }) => product.includes('PEI'))).toBe(false)
  })

  it('does not take an address postcode for a colour', () => {
    expect(parseOrderEmail('Bambu Lab\nShipping address\nExample City 10115\n')).toBeUndefined()
  })

  it('recognises no order in an email from another shop', () => {
    expect(parseOrderEmail('Example Shop\nPLA × 1\nGray (10103) / 1 kg\n€20.00')).toBeUndefined()
  })

  it('recognises no order in text without filament lines', () => {
    expect(parseOrderEmail('Bambu Lab\nYour parcel is on its way')).toBeUndefined()
  })

  it('tries each given parser in turn', () => {
    const other: OrderParser = {
      vendor: 'bambu-lab',
      recognises: (lines) => lines.includes('Other shop'),
      parse: () => ({ lines: [{ product: 'Resin', quantity: 1 }] }),
    }
    expect(parseOrderEmail('Other shop', [other])?.lines).toEqual([{ product: 'Resin', quantity: 1 }])
  })
})

describe('orderEmailLines', () => {
  it('leaves no markup when tags are nested to survive one pass of stripping', () => {
    const lines = orderEmailLines(
      '<html><body><scr<script>x</script>ipt>alert(1)</script><!<!--x-->-- y -->Gray 10103</body></html><script',
    )
    expect(lines.join('\n')).not.toMatch(/[<>]/)
  })

  it('turns HTML into its text, a line per block', () => {
    expect(orderEmailLines('<p>One&nbsp;&amp; two</p><div>Three<br>Four</div>')).toEqual(['One & two', 'Three', 'Four'])
  })

  it('drops styles and scripts', () => {
    expect(orderEmailLines('<style>p{}</style><script>x()</script><p>Text</p>')).toEqual(['Text'])
  })

  it('decodes numeric entities', () => {
    expect(orderEmailLines('<p>&#8364;5 &#x00D7; 2</p>')).toEqual(['€5 × 2'])
  })
})

describe('moneyIn', () => {
  it('reads a symbol before the amount', () => {
    expect(moneyIn('€33.98')).toEqual([{ amount: 33.98, currency: 'EUR' }])
  })

  it('reads a decimal comma and a symbol after the amount', () => {
    expect(moneyIn('16,99 €')).toEqual([{ amount: 16.99, currency: 'EUR' }])
  })

  it('reads thousands separators', () => {
    expect(moneyIn('1.234,56 €')).toEqual([{ amount: 1_234.56, currency: 'EUR' }])
  })

  it('reads an ISO code', () => {
    expect(moneyIn('Total GBP 45.00')).toEqual([{ amount: 45, currency: 'GBP' }])
  })

  it('does not read a quantity before a price as money', () => {
    expect(moneyIn('× 2 €33.98')).toEqual([{ amount: 33.98, currency: 'EUR' }])
  })

  it('reads a discount as negative', () => {
    expect(moneyIn('Discount -€5.00')).toEqual([{ amount: -5, currency: 'EUR' }])
  })
})
