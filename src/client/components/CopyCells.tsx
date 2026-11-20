import { cn } from '@/lib/utils'
import { statusText } from '../../core/i18n'
import { workflow, type StatusId } from '../../core/workflow'
import { useI18n } from '../i18n'

/** Past this many copies the cells would wrap into noise, so the stages draw as proportional bands instead. */
const MAX_CELLS = 24

/**
 * Every copy of a request as one mark in its stage colour, furthest stage first, so the marks fill from the finished end.
 * The copies this card holds stay solid and the rest recede.
 */
export function CopyCells({
  counts,
  status,
  stamp = false,
  className,
}: {
  counts: Record<string, number>
  /** The stage whose copies stay solid; without one, every copy does. */
  status?: StatusId
  /** Stamps this stage's copies in one after another, as they arrive in it. */
  stamp?: boolean
  className?: string
}) {
  const { t } = useI18n()
  const stages = workflow.statuses
    .map(({ id }) => id)
    .toReversed()
    .filter((id) => (counts[id] ?? 0) > 0)
  if (stages.length === 0) return null
  const label = t.board.pass.copiesByStage(stages.map((id) => `${counts[id]} ${statusText(t, 'label', id)}`).join(', '))
  const banded = stages.reduce((total, id) => total + counts[id], 0) > MAX_CELLS
  return (
    // Relative so the screen-reader label stays inside whatever scroll container holds the cells.
    <span className={cn('relative flex', className)}>
      <span className="sr-only">{label}</span>
      <span aria-hidden="true" className={cn('flex', banded ? 'h-2 w-full overflow-hidden rounded-[2px]' : 'flex-wrap gap-[3px]')}>
        {stages.map((id) =>
          banded ? (
            <span
              key={id}
              data-stage={id}
              className={cn('h-full bg-(--stage)', status && id !== status && 'opacity-35')}
              style={{ flexGrow: counts[id] }}
            />
          ) : (
            Array.from({ length: counts[id] }, (_, copy) => (
              <span
                key={`${id}:${copy}`}
                data-stage={id}
                className={cn(
                  'size-2 rounded-[2px] bg-(--stage) transition-colors duration-300',
                  status && id !== status && 'opacity-35',
                  stamp && id === status && 'motion-safe:animate-[cell-stamp_320ms_cubic-bezier(0.16,1,0.3,1)_both]',
                )}
                style={stamp && id === status ? { animationDelay: `${copy * 25}ms` } : undefined}
              />
            ))
          ),
        )}
      </span>
    </span>
  )
}
