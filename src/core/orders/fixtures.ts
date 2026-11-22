/**
 * Order confirmations shaped like the Bambu Lab EU store's, with made-up order numbers, people, and addresses. Each is
 * what pasting the email gives: plain text copied from a mail app, or the message's HTML source.
 */

export const BAMBU_LAB_EU_TEXT = `Bambu Lab EU Store
Order #TEST-0001

Thank you for your purchase!
Hi Alex, we're getting your order ready to be shipped. We will notify you when it has been sent.

View your order or Visit our store

Order summary

PLA Basic × 2
Gray (10103) / Refill / 1 kg
€33.98

PLA Matte × 1
Charcoal (11101) / Filament with spool / 1 kg
€21.99

PETG HF × 3
Black (33102) / Refill / 1 kg
€59.97

Textured PEI Plate × 1
€29.99

Subtotal
€145.93
Shipping
€0.00
Taxes
€23.30
Total
€145.93 EUR

Customer information
Shipping address
Alex Example
1 Example Street
10115 Example City
Germany
`

export const BAMBU_LAB_EU_GERMAN_TEXT = `Bambu Lab EU Store
Bestellung #TEST-0002

Vielen Dank für Ihren Einkauf!

Bestellübersicht

PLA Basic - Jade White (10100) / Nachfüllpackung / 1 kg × 1
16,99 €

PLA Basic - Gray (10103) / Mit Spule / 1 kg × 2
39,98 €

Zwischensumme
56,97 €
Gesamt
56,97 € EUR
`

export const BAMBU_LAB_EU_HTML = `<!DOCTYPE html>
<html><head><title>Order #TEST-0003 confirmed</title><style>.price{font-weight:600}</style></head>
<body>
<table class="row">
  <tr><td><img src="https://example.com/logo.png" alt="Bambu Lab"></td><td>Order #TEST-0003</td></tr>
</table>
<h2>Order summary</h2>
<table class="row">
  <tr class="order-list__item">
    <td><img src="https://example.com/pla-basic.jpg" alt=""></td>
    <td><span class="order-list__item-title">PLA Basic&nbsp;&times;&nbsp;4</span><br>
      <span class="order-list__item-variant">Bambu Green (10501) / Refill / 1 kg</span></td>
    <td><p class="order-list__item-price">&euro;67.96</p></td>
  </tr>
  <tr class="order-list__item">
    <td><img src="https://example.com/silk.jpg" alt=""></td>
    <td><span class="order-list__item-title">PLA Silk+&nbsp;&times;&nbsp;1</span><br>
      <span class="order-list__item-variant">Gold (13405) / Filament with spool / 1 kg</span></td>
    <td><p class="order-list__item-price"><del>&euro;29.99</del></p><p class="order-list__item-price">&euro;24.99</p></td>
  </tr>
</table>
<table class="row subtotal-lines">
  <tr><td><p>Subtotal</p></td><td><strong>&euro;92.95</strong></td></tr>
  <tr><td><p>Total</p></td><td><strong>&euro;92.95 EUR</strong></td></tr>
</table>
<p class="disclaimer">If you have any questions, reply to this email or contact us. &copy; Bambu Lab</p>
</body></html>
`

/** The HTML above as a mail client's "show original" gives it: quoted-printable, with soft line breaks. */
export const BAMBU_LAB_EU_QUOTED_PRINTABLE = `Content-Type: text/html; charset="utf-8"
Content-Transfer-Encoding: quoted-printable

<table><tr><td><span>Bambu Lab</span></td></tr>
<tr><td><span class=3D"order-list__item-title">PLA Basic =C3=97 2</span><br>=
<span class=3D"order-list__item-variant">Gray (10103) / Refill / 1 kg</span></td>=
<td>=E2=82=AC33.98</td></tr></table>
`
