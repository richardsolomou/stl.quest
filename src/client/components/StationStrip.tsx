import { cn } from '@/lib/utils'
import type { BoardRequestEntry } from '../boardEntries'
import type { BoardStation } from '../boardStations'
import { useI18n } from '../i18n'

/**
 * Idle printers the strip names at each board width before folding the rest into a count, so it stays one line whether
 * the fleet is two printers or a farm. Each tier's count chip shows only at its own width.
 */
const NAMED_IDLE = [
  { count: 1, visible: '@max-[1199px]:flex', hidden: '@max-[1199px]:hidden' },
  { count: 2, visible: '@min-[1200px]:@max-[1399px]:flex', hidden: '@min-[1200px]:@max-[1399px]:hidden' },
  { count: 4, visible: '@min-[1400px]:flex', hidden: '@min-[1400px]:hidden' },
] as const

function scrollToStation(id: string) {
  document.querySelector(`[data-station="${CSS.escape(id)}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
}

/**
 * The fleet at a glance for when the printer stations sit below the fold: idle printers by name, since those are what the
 * operator acts on, and every busy printer folded into one count.
 */
export function StationStrip({ stations, className }: { stations: BoardStation<BoardRequestEntry>[]; className?: string }) {
  const { t } = useI18n()
  const pass = t.board.pass
  const fleet = stations.filter((station) => station.printer)
  // One printer's station is already in view under its own heading, so the strip would only repeat it.
  if (fleet.length < 2) return null
  const busy = fleet.filter((station) => station.entries.length > 0)
  const idle = fleet.filter((station) => station.entries.length === 0)
  const widest = NAMED_IDLE.at(-1)!.count
  const chip = 'flex h-7 shrink-0 cursor-pointer items-center gap-1.5 rounded-[4px] px-2 text-xs font-bold whitespace-nowrap'
  return (
    <nav aria-label={pass.printers} className={cn('flex min-w-0 shrink-0 gap-1.5 overflow-hidden', className)}>
      {busy.length > 0 && (
        <button
          type="button"
          data-stage="in_progress"
          className={cn(chip, 'bg-(--stage) text-(--stage-foreground)')}
          onClick={() => scrollToStation(busy[0].printer!.id)}
        >
          {pass.printingCount(busy.length)}
        </button>
      )}
      {idle.slice(0, widest).map((station, index) => (
        <button
          key={station.printer!.id}
          type="button"
          className={cn(
            chip,
            'max-w-[11rem] bg-shell text-shell-foreground',
            NAMED_IDLE.filter((tier) => index >= tier.count).map((tier) => tier.hidden),
          )}
          onClick={() => scrollToStation(station.printer!.id)}
        >
          <span className="min-w-0 truncate">{station.printer!.name}</span>
          <span className="shrink-0 font-mono text-[11px] font-medium uppercase opacity-80">{pass.idle}</span>
        </button>
      ))}
      {NAMED_IDLE.map(
        (tier) =>
          idle.length > tier.count && (
            <button
              key={tier.count}
              type="button"
              className={cn(chip, 'hidden border border-foreground/30 text-foreground', tier.visible)}
              onClick={() => scrollToStation(idle[tier.count].printer!.id)}
            >
              {pass.moreIdle(idle.length - tier.count)}
            </button>
          ),
      )}
    </nav>
  )
}
