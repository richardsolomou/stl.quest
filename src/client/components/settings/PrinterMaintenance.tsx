import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { Button } from '@/components/ui/button'
import { FieldError } from '@/components/ui/field'
import { Spinner } from '@/components/ui/spinner'
import { cn } from '@/lib/utils'
import { wearPartsFor, type PartConsumable } from '../../../core/consumables'
import { partWear, type PartWear } from '../../../core/maintenance'
import type { PrinterProfile } from '../../../core/types'
import type { StockLevel } from '../../../core/usage'
import { useI18n } from '../../i18n'
import { consumablesQuery, stockQuery, usageQuery } from '../../queries'
import { useWorkspaceSlug } from '../../workspace'
import { formatNumber } from '../priceCalculator/format'
import { useStockMovements } from './ConsumableStock'

// From here a part reads as nearly worn, so a replacement can be ordered in time.
const NEARLY_WORN = 0.8

/**
 * The wear parts a saved printer uses, each counted from the prints it ran since the part was last replaced on it.
 * Logging a replacement takes a spare off the shelf and starts the count again.
 */
export function PrinterMaintenance({ printer }: { printer: PrinterProfile }) {
  const { t } = useI18n()
  const copy = t.settings.printers.dialog.maintenance
  const workspaceSlug = useWorkspaceSlug()
  const consumables = useQuery(consumablesQuery(workspaceSlug)).data?.consumables
  const events = useQuery(usageQuery(workspaceSlug, { printerId: printer.id })).data?.events
  const levels = useQuery(stockQuery(workspaceSlug)).data?.stock ?? []
  if (!consumables || !events) return null
  const parts = wearPartsFor(consumables, printer.printType, printer)
  return (
    <section className="grid gap-2" aria-labelledby="printer-maintenance">
      <div className="grid gap-0.5">
        <h3 id="printer-maintenance" className="text-sm font-medium">
          {copy.title}
        </h3>
        <p className="text-sm text-muted-foreground">
          {parts.length ? (
            copy.hint
          ) : (
            <>
              {copy.empty}{' '}
              <Link
                to="/settings/$section"
                params={{ section: 'consumables' }}
                className="font-medium text-foreground underline underline-offset-2"
              >
                {copy.manage}
              </Link>
            </>
          )}
        </p>
      </div>
      {parts.length > 0 && (
        <ul className="grid divide-y rounded-lg border bg-muted/20 px-3">
          {parts.map((part) => (
            <WearPartRow
              key={part.id}
              workspaceSlug={workspaceSlug}
              printerId={printer.id}
              part={part}
              wear={partWear(events, printer.id, part)}
              level={levels.find(({ consumableId }) => consumableId === part.id)}
            />
          ))}
        </ul>
      )}
    </section>
  )
}

function WearPartRow({
  workspaceSlug,
  printerId,
  part,
  wear,
  level,
}: {
  workspaceSlug: string
  printerId: string
  part: PartConsumable
  wear: PartWear
  level?: StockLevel
}) {
  const { t, locale } = useI18n()
  const copy = t.settings.printers.dialog.maintenance
  const { movement, undo } = useStockMovements(workspaceSlug)
  const [replacement, setReplacement] = useState<string>()
  const ratio = wear.lifespan > 0 ? Math.min(1, wear.used / wear.lifespan) : 0
  const spares = level?.tracked ? Math.max(0, level.onHand) : undefined
  const date = new Intl.DateTimeFormat(locale, { dateStyle: 'medium' })
  const details = [
    wear.replacedAt === undefined ? copy.neverReplaced : copy.replacedOn(date.format(wear.replacedAt)),
    spares === undefined ? undefined : spares > 0 ? copy.spares(formatNumber(spares, locale)) : copy.noSpares,
  ].filter(Boolean)
  return (
    <li className="grid gap-1.5 py-2.5">
      <div className="flex min-w-0 items-center gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium [overflow-wrap:anywhere]">{part.name}</p>
          <p className={cn('font-mono text-xs tabular-nums', wear.due ? 'font-semibold text-destructive' : 'text-muted-foreground')}>
            {wear.due && `${copy.due} · `}
            {copy.wear(formatNumber(wear.used, locale, wear.unit === 'hours' ? 1 : 0), formatNumber(wear.lifespan, locale), wear.unit)}
          </p>
        </div>
        {replacement ? (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            disabled={undo.isPending}
            onClick={() => undo.mutate(replacement, { onSuccess: () => setReplacement(undefined) })}
          >
            {copy.undo}
          </Button>
        ) : (
          <Button
            type="button"
            size="sm"
            variant="outline"
            aria-label={copy.replacedLabel(part.name)}
            disabled={movement.isPending}
            onClick={() =>
              movement.mutate(
                { consumableId: part.id, kind: 'replace', amount: 1, printerId },
                { onSuccess: ({ transactionId }) => setReplacement(transactionId) },
              )
            }
          >
            {movement.isPending && <Spinner />} {copy.replaced}
          </Button>
        )}
      </div>
      <div aria-hidden="true" className="h-1 overflow-hidden rounded-full bg-muted">
        <div
          className={cn(
            'h-full rounded-full',
            wear.due ? 'bg-destructive' : ratio >= NEARLY_WORN ? 'bg-(--stage-in_progress)' : 'bg-foreground/45',
          )}
          style={{ width: `${ratio * 100}%` }}
        />
      </div>
      <p className="text-xs text-muted-foreground">{details.join(' · ')}</p>
      {(movement.error != null || undo.error != null) && <FieldError>{copy.error}</FieldError>}
    </li>
  )
}
