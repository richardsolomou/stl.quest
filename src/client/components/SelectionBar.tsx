import { Archive, Calculator, Download, Layers, Layers3, Move, RotateCcw, Trash2, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { MAX_BULK_CARDS } from '../../core/request'
import { useI18n } from '../i18n'

type Action = { onClick: () => void } | undefined

/**
 * What is selected and what can be done with it, floating above the board for as long as a selection lasts, so bulk work
 * does not depend on discovering the right-click menu. Each action is present only when every selected print allows it.
 */
export function SelectionBar({
  prints,
  copies,
  move,
  tags,
  download,
  repeat,
  estimate,
  plate,
  archive,
  remove,
  overLimit,
  onClear,
}: {
  prints: number
  copies: number
  move: Action
  tags: Action
  download: Action
  repeat: Action
  estimate: Action
  /** Records the selected copies as one run of a printer, for its slicer totals to be split across. */
  plate: Action
  archive: Action
  remove: Action
  /** More cards are selected than one bulk action takes, so no action is offered. */
  overLimit: boolean
  onClear: () => void
}) {
  const { t, locale } = useI18n()
  const actions = t.requests.actions
  const pass = t.board.pass
  const items = [
    { action: move, icon: <Move />, label: actions.move },
    { action: tags, icon: <Layers3 />, label: actions.manageTags },
    { action: download, icon: <Download />, label: actions.downloadModels(prints) },
    { action: repeat, icon: <RotateCcw />, label: actions.printAgain },
    { action: estimate, icon: <Calculator />, label: actions.estimate },
    { action: plate, icon: <Layers />, label: t.plates.putOnPlate },
    { action: archive, icon: <Archive />, label: actions.archive },
  ]
  return (
    <div
      role="toolbar"
      aria-label={pass.selectionActions}
      data-selection-controls
      className="on-shell fixed bottom-4 left-1/2 z-40 flex max-w-[calc(100vw-1.5rem)] -translate-x-1/2 max-sm:left-3 max-sm:max-w-[calc(100vw-5.5rem)] max-sm:translate-x-0 items-center gap-1 rounded-lg bg-shell p-1.5 pl-3 text-shell-foreground shadow-xl motion-safe:animate-in motion-safe:fade-in-0 motion-safe:slide-in-from-bottom-2 max-sm:bottom-20"
    >
      <span className="mr-1 shrink-0 text-sm font-semibold whitespace-nowrap max-md:hidden" aria-live="polite">
        {pass.selected(prints, copies)}
      </span>
      <span className="mr-1 shrink-0 font-mono text-xs md:hidden" aria-hidden="true">
        {prints}
      </span>
      {overLimit ? (
        <p className="min-w-0 px-1 text-sm text-shell-foreground/75">{pass.tooManySelected(MAX_BULK_CARDS.toLocaleString(locale))}</p>
      ) : (
        <div className="no-scrollbar flex min-w-0 items-center gap-1 overflow-x-auto">
          {items.map(
            ({ action, icon, label }) =>
              action && (
                <Button key={label} type="button" variant="ghost" size="sm" className="shrink-0 max-lg:px-1.5" onClick={action.onClick}>
                  {icon}
                  <span className="max-lg:sr-only">{label}</span>
                </Button>
              ),
          )}
          {remove && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="shrink-0 text-destructive hover:text-destructive max-lg:px-1.5"
              onClick={remove.onClick}
            >
              <Trash2 />
              <span className="max-lg:sr-only">{t.common.delete}</span>
            </Button>
          )}
        </div>
      )}
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        className="shrink-0"
        aria-label={pass.clearSelection}
        title={pass.clearSelection}
        onClick={onClear}
      >
        <X />
      </Button>
    </div>
  )
}
