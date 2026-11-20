import { useEffect, useRef, useState } from 'react'
import { ChevronRight } from 'lucide-react'
import { formatDate } from '../../../core/format'
import type { PriceCalculatorCurrency } from '../../../core/priceCalculator'
import type { SpendBucket } from '../../../core/spend'
import { useI18n } from '../../i18n'
import { formatMoney } from '../priceCalculator/format'

const PLOT_HEIGHT = 180
const AXIS_BAND = 24
const LEFT_GUTTER = 56
const TOP_ROOM = 20

/** Rounds the top of the axis up to an amount whose half is also clean, so both ticks land on round numbers. */
function niceCeiling(value: number) {
  if (value <= 0) return 1
  const power = 10 ** Math.floor(Math.log10(value))
  return ([1, 2, 3, 4, 5, 6, 8, 10].find((step) => step * power >= value) ?? 10) * power
}

/** A column with a 4px rounded top, square on the baseline. */
function column(x: number, y: number, width: number, height: number) {
  const radius = Math.min(4, width / 2, height)
  return `M${x},${y + height}V${y + radius}Q${x},${y} ${x + radius},${y}H${x + width - radius}Q${x + width},${y} ${x + width},${y + radius}V${y + height}Z`
}

/** Spend per day or week as columns in one hue: one series, so the title names it and no legend is needed. */
export function SpendTrendChart({ buckets, currency }: { buckets: SpendBucket[]; currency: PriceCalculatorCurrency }) {
  const { t, locale } = useI18n()
  const money = (value: number) => formatMoney(value, currency, locale)
  const copy = t.spend.trend
  const frame = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(0)
  const [active, setActive] = useState<number>()
  useEffect(() => {
    const element = frame.current
    if (!element) return
    const observer = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width))
    observer.observe(element)
    return () => observer.disconnect()
  }, [])
  const weekly = buckets.length > 1 && buckets[1].start - buckets[0].start > 2 * 86_400_000
  const highest = buckets.reduce((best, bucket, index) => (bucket.cost > (buckets[best]?.cost ?? 0) ? index : best), 0)
  const top = niceCeiling(buckets[highest]?.cost ?? 0)
  const ticks = [0, top / 2, top]
  const tickFormat = new Intl.NumberFormat(locale, { style: 'currency', currency, maximumFractionDigits: top >= 10 ? 0 : 2 })
  const plotWidth = Math.max(0, width - LEFT_GUTTER)
  const band = buckets.length ? plotWidth / buckets.length : 0
  const barWidth = Math.max(1, Math.min(24, band - 2))
  const y = (value: number) => TOP_ROOM + PLOT_HEIGHT - (value / top) * PLOT_HEIGHT
  const labelEvery = Math.max(1, Math.ceil(buckets.length / Math.max(1, Math.floor(plotWidth / 72))))
  const label = (bucket: SpendBucket) => formatDate(bucket.start, locale)
  const shown = active === undefined ? undefined : buckets[active]
  const summary = copy.summary(label(buckets[0]), label(buckets.at(-1)!), money(buckets[highest]?.cost ?? 0))

  return (
    <div className="flex flex-col gap-3">
      <p className="text-xs text-muted-foreground">{weekly ? copy.weekly : copy.daily}</p>
      <div
        ref={frame}
        className="relative rounded-sm has-[input:focus-visible]:ring-2 has-[input:focus-visible]:ring-ring"
        onPointerLeave={() => setActive(undefined)}
      >
        {/* Arrow keys step through the periods, showing the same readout as hovering. */}
        <input
          type="range"
          className="sr-only"
          min={0}
          max={buckets.length - 1}
          value={active ?? buckets.length - 1}
          aria-label={summary}
          aria-valuetext={shown ? `${money(shown.cost)}, ${label(shown)}` : undefined}
          onChange={(event) => setActive(Number(event.target.value))}
          onFocus={() => setActive((current) => current ?? buckets.length - 1)}
          onBlur={() => setActive(undefined)}
        />
        {width > 0 && (
          <svg width={width} height={TOP_ROOM + PLOT_HEIGHT + AXIS_BAND} aria-hidden="true" className="block">
            {ticks.map((tick) => (
              <g key={tick}>
                <line x1={LEFT_GUTTER} x2={width} y1={y(tick)} y2={y(tick)} className="stroke-border" strokeWidth={1} />
                <text
                  x={LEFT_GUTTER - 8}
                  y={y(tick)}
                  dy="0.32em"
                  textAnchor="end"
                  className="fill-muted-foreground font-mono text-[11px] tabular-nums"
                >
                  {tickFormat.format(tick)}
                </text>
              </g>
            ))}
            {buckets.map((bucket, index) => {
              const x = LEFT_GUTTER + index * band
              const height = (bucket.cost / top) * PLOT_HEIGHT
              const isActive = index === active
              return (
                <g key={bucket.start} onPointerEnter={() => setActive(index)}>
                  {isActive && <rect x={x} y={TOP_ROOM} width={band} height={PLOT_HEIGHT} className="fill-foreground/5" />}
                  <rect x={x} y={0} width={band} height={TOP_ROOM + PLOT_HEIGHT + AXIS_BAND} fill="transparent" />
                  {height > 0 && (
                    <path
                      d={column(x + (band - barWidth) / 2, y(bucket.cost), barWidth, height)}
                      className={isActive ? 'fill-chart-1 opacity-80' : 'fill-chart-1'}
                    />
                  )}
                  {index === highest && bucket.cost > 0 && (
                    <text
                      x={Math.min(Math.max(x + band / 2, LEFT_GUTTER + 24), width - 24)}
                      y={y(bucket.cost) - 6}
                      textAnchor="middle"
                      className="fill-foreground font-mono text-[11px] font-medium tabular-nums"
                    >
                      {money(bucket.cost)}
                    </text>
                  )}
                  {index % labelEvery === 0 && (
                    <text
                      x={x + band / 2}
                      y={TOP_ROOM + PLOT_HEIGHT + 16}
                      textAnchor={index === 0 ? 'start' : 'middle'}
                      className="fill-muted-foreground text-[11px]"
                    >
                      {new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short' }).format(bucket.start)}
                    </text>
                  )}
                </g>
              )
            })}
          </svg>
        )}
        {shown && active !== undefined && (
          <output
            className="pointer-events-none absolute top-0 z-10 flex -translate-x-1/2 flex-col rounded-md border border-border bg-popover px-2.5 py-1.5 text-xs shadow-md"
            style={{ left: Math.min(Math.max(LEFT_GUTTER + (active + 0.5) * band, 64), width - 64) }}
          >
            <strong className="font-mono text-sm font-semibold text-popover-foreground tabular-nums">{money(shown.cost)}</strong>
            <span className="whitespace-nowrap text-muted-foreground">{weekly ? `${copy.week} ${label(shown)}` : label(shown)}</span>
          </output>
        )}
      </div>
      <details className="group text-xs">
        <summary className="flex cursor-pointer list-none items-center gap-1 text-muted-foreground hover:text-foreground [&::-webkit-details-marker]:hidden">
          <ChevronRight className="size-3.5 shrink-0 transition-transform group-open:rotate-90" />
          {copy.showTable}
        </summary>
        <table className="mt-2 w-full max-w-sm text-sm">
          <thead>
            <tr className="border-b border-border text-left text-xs text-muted-foreground">
              <th className="py-1 font-medium">{weekly ? copy.week : copy.day}</th>
              <th className="py-1 text-right font-medium">{copy.cost}</th>
            </tr>
          </thead>
          <tbody>
            {buckets.map((bucket) => (
              <tr key={bucket.start} className="border-b border-border/60 last:border-0">
                <td className="py-1">{label(bucket)}</td>
                <td className="py-1 text-right font-mono tabular-nums">{money(bucket.cost)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </div>
  )
}
