import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useI18n } from '../../i18n'
import { platesQuery } from '../../queries'
import { useWorkspaceSlug } from '../../workspace'
import { DetailRow } from '../DetailRow'
import { formatUsageAmount } from '../spend/format'
import { PlateDialog } from './PlateDialog'

/** Admin-only, while usage is tracked: the plates a print went on, each opening its plate. */
export function RequestPlates({ requestId }: { requestId: string }) {
  const { t, locale } = useI18n()
  const workspaceSlug = useWorkspaceSlug()
  const plates = useQuery(platesQuery(workspaceSlug)).data?.plates.filter((plate) =>
    plate.items.some((item) => item.requestId === requestId),
  )
  const [open, setOpen] = useState<string>()
  if (!plates?.length) return null
  return (
    <DetailRow label={t.requests.plates}>
      <ul className="flex flex-col gap-0.5">
        {plates.map((plate) => {
          const item = plate.items.find((candidate) => candidate.requestId === requestId)!
          return (
            <li key={plate.id} className="flex flex-wrap items-baseline gap-x-2">
              <button
                type="button"
                className="cursor-pointer font-medium underline decoration-primary decoration-2 underline-offset-4 hover:decoration-foreground"
                onClick={() => setOpen(plate.id)}
              >
                {t.plates.onPlate(plate.number)}
              </button>
              <span className="font-mono text-xs text-muted-foreground">×{item.copies}</span>
              {plate.recording && item.amount !== undefined && (
                <span className="font-mono text-xs text-muted-foreground tabular-nums">
                  {formatUsageAmount(item.amount, plate.recording.unit, t.spend, locale)}
                </span>
              )}
            </li>
          )
        })}
      </ul>
      {open && <PlateDialog plateId={open} onClose={() => setOpen(undefined)} />}
    </DetailRow>
  )
}
