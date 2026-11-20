import { Check, FileUp, Layers } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useI18n } from '../../i18n'
import type { PlateView } from '../../queries'
import { formatUsageAmount } from '../spend/format'
import type { PlateMode } from './PlateDialog'

/** A printer's plates on its station: each one line, offering to record it until it is, then what it used. */
export function StationPlates({ plates, onOpen }: { plates: PlateView[]; onOpen: (plateId: string, mode: PlateMode) => void }) {
  const { t, locale } = useI18n()
  const copy = t.plates
  return (
    <ul className="flex flex-col gap-1 border-b border-border px-2 py-1.5" aria-label={copy.putOnPlate}>
      {plates.map((plate) => (
        <li key={plate.id} className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm" data-plate={plate.number}>
          <button
            type="button"
            className="flex min-w-0 cursor-pointer items-center gap-1.5 rounded-sm font-medium hover:underline"
            onClick={() => onOpen(plate.id, 'view')}
          >
            <Layers className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
            <span className="truncate">{copy.name(plate.number)}</span>
            <span className="shrink-0 font-normal text-muted-foreground">· {copy.station(plate.items.length)}</span>
          </button>
          {plate.recording ? (
            <span className="ml-auto flex items-center gap-1 font-mono text-xs text-muted-foreground tabular-nums">
              <Check className="size-3.5" aria-hidden="true" />
              {formatUsageAmount(
                plate.items.reduce((total, item) => total + (item.amount ?? 0), plate.recording.otherAmount),
                plate.recording.unit,
                t.spend,
                locale,
              )}
            </span>
          ) : (
            <span className="ml-auto flex gap-1">
              <Button type="button" size="xs" variant="ghost" onClick={() => onOpen(plate.id, 'totals')}>
                {copy.enterTotals}
              </Button>
              {plate.printType !== 'resin' && (
                <Button type="button" size="xs" variant="outline" onClick={() => onOpen(plate.id, 'file')}>
                  <FileUp />
                  {copy.uploadFile}
                </Button>
              )}
            </span>
          )}
        </li>
      ))}
    </ul>
  )
}
