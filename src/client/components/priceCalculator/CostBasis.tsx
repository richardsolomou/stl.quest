import { Fragment, useId } from 'react'
import type { CostBasis, PriceCalculatorCurrency } from '../../../core/priceCalculator'
import { useI18n } from '../../i18n'
import { formatMoney, formatNumber, formatRate } from './format'

/** Marks a figure that fell back to a stand-in, by default a typical value because nothing was picked. */
export function TypicalTag({ label }: { label?: string }) {
  const copy = useI18n().t.calculator.quote
  return (
    <span className="ml-1.5 rounded-sm border border-dashed border-border px-1 py-px align-[1px] text-[10px] font-medium tracking-wide whitespace-nowrap text-muted-foreground uppercase">
      {label ?? copy.typical}
    </span>
  )
}

export type CostBasisEntry = { key: string; basis: CostBasis; printerName?: string; materialName?: string }

/**
 * The rates behind a quote: what each printer costs per print hour and per plate, then the material and each piece of
 * equipment, once per print type. Compact lists summarise each printer on one line, for a batch across many printers.
 */
export function CostBasisList({
  entries,
  currency,
  compact = false,
}: {
  entries: CostBasisEntry[]
  currency: PriceCalculatorCurrency
  compact?: boolean
}) {
  const { t, locale } = useI18n()
  const copy = t.calculator.basis
  const headingId = useId()
  const rate = (value: number) => formatRate(value, currency, locale)
  const money = (value: number) => formatMoney(value, currency, locale)
  const printTypes = entries.filter(
    (entry, index) => entries.findIndex(({ basis }) => basis.material.unit === entry.basis.material.unit) === index,
  )
  return (
    <section aria-labelledby={headingId} className="grid gap-2.5 border-t border-border/70 pt-3">
      <div className="grid gap-0.5">
        <h3 id={headingId} className="font-heading text-sm font-extrabold tracking-[0.015em] uppercase">
          {copy.title}
        </h3>
        <p className="text-xs text-muted-foreground">{copy.description}</p>
      </div>
      <dl className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-4 gap-y-2 text-sm">
        {entries.map(({ key, basis: { hour, plate }, printerName }) => {
          const plateParts = copy.perPlate(rate(plate.parts.reduce((total, { cost }) => total + cost, 0)))
          return (
            <Fragment key={key}>
              <BasisRow
                label={printerName ?? copy.typicalPrinter}
                typical={hour.typical || hour.wearTypical}
                value={copy.perHour(rate(hour.total))}
                details={
                  compact
                    ? [plate.parts.length > 0 && copy.plateParts(plateParts)]
                    : [
                        copy.power(formatNumber(hour.watts, locale), rate(hour.electricity)),
                        hour.wear > 0 && copy.wear(rate(hour.wear)),
                        ...hour.parts.map(({ part, cost }) => `${part.name} ${rate(cost)}`),
                      ]
                }
              />
              {!compact && plate.parts.length > 0 && (
                <BasisRow
                  label={copy.platePartsLabel}
                  value={plateParts}
                  details={plate.parts.map(({ part, cost }) => `${part.name} ${rate(cost)}`)}
                />
              )}
            </Fragment>
          )
        })}
        {printTypes.map(({ key, basis: { plate, material }, materialName }) => {
          const resin = material.unit === 'ml'
          return (
            <Fragment key={key}>
              <BasisRow
                label={materialName ?? (resin ? copy.typicalResin : copy.typicalFilament)}
                typical={material.typical}
                value={copy.perUnit(rate(material.cost), resin ? 'mL' : 'g')}
                details={[
                  material.pack
                    ? (resin ? copy.bottle : copy.spool)(money(material.pack.cost), formatNumber(material.pack.size, locale))
                    : (resin ? copy.perLitre : copy.perKilogram)(money(material.cost * 1_000)),
                ]}
              />
              {plate.equipment.map(({ item, typical, electricity, supplies, wear }) => (
                <BasisRow
                  key={item.id}
                  label={typical ? t.calculator.quote.typicalFinishing : item.name}
                  typical={typical}
                  value={copy.perUse(rate(electricity + supplies + wear))}
                  details={[
                    copy.minutes(formatNumber(item.minutesPerUse, locale)),
                    copy.power(formatNumber(item.powerWatts, locale), rate(electricity)),
                    supplies > 0 && copy.supplies(rate(supplies)),
                    wear > 0 && copy.wear(rate(wear)),
                  ]}
                />
              ))}
            </Fragment>
          )
        })}
      </dl>
    </section>
  )
}

function BasisRow({
  label,
  value,
  typical = false,
  details,
}: {
  label: string
  value: string
  typical?: boolean
  details: (string | false)[]
}) {
  const shown = details.filter(Boolean)
  return (
    <>
      <dt className="min-w-0">
        <span className="font-medium">{label}</span>
        {typical && <TypicalTag />}
        {shown.length > 0 && <span className="block text-xs text-muted-foreground">{shown.join(' · ')}</span>}
      </dt>
      <dd className="text-right font-mono tabular-nums">{value}</dd>
    </>
  )
}
