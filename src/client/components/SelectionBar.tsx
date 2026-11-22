import { Archive, Calculator, Download, Layers, Layers3, MoreHorizontal, Move, Printer, RotateCcw, Trash2, X } from 'lucide-react'
import type { ReactNode } from 'react'
import { Button } from '@/components/ui/button'
import { Menu, MenuContent, MenuItem, MenuSeparator, MenuTrigger } from '@/components/ui/menu'
import type { PrinterProfile } from '../../core/types'
import { MAX_BULK_CARDS } from '../../core/request'
import { useI18n } from '../i18n'

type Action = { onClick: () => void } | undefined
/** The printers every print acted on can go on, offered as one menu. */
export type AssignAction = { printers: Pick<PrinterProfile, 'id' | 'name'>[]; onAssign: (printerId: string) => void }

/**
 * What is selected and what can be done with it, floating above the board for as long as a selection lasts, so bulk work
 * does not depend on discovering the right-click menu. Each action is present only when every selected print allows it.
 */
export function SelectionBar({
  prints,
  copies,
  move,
  assign,
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
  assign: AssignAction | undefined
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
  // The everyday actions stay one click away; the rest wait in More so the bar keeps its size as actions are added.
  const barButton = 'shrink-0 max-lg:px-1.5'
  const barAction = (action: Action, icon: ReactNode, label: string) =>
    action && (
      <Button type="button" variant="ghost" size="sm" className={barButton} onClick={action.onClick}>
        {icon}
        <span className="max-lg:sr-only">{label}</span>
      </Button>
    )
  const more = [
    { action: tags, icon: <Layers3 />, label: actions.manageTags },
    { action: plate, icon: <Layers />, label: t.plates.startPlate },
    { action: estimate, icon: <Calculator />, label: actions.estimate },
    { action: repeat, icon: <RotateCcw />, label: actions.printAgain },
    { action: download, icon: <Download />, label: actions.downloadModels(prints) },
  ].filter((item) => item.action)
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
        <div className="flex min-w-0 items-center gap-1">
          {barAction(move, <Move />, actions.move)}
          {assign && (
            <Menu>
              <MenuTrigger render={<Button type="button" variant="ghost" size="sm" className={barButton} />}>
                <Printer />
                <span className="max-lg:sr-only">{actions.assignPrinter}</span>
              </MenuTrigger>
              <MenuContent side="top">
                {assign.printers.map((printer) => (
                  <MenuItem key={printer.id} onClick={() => assign.onAssign(printer.id)}>
                    {printer.name}
                  </MenuItem>
                ))}
              </MenuContent>
            </Menu>
          )}
          {barAction(archive, <Archive />, actions.archive)}
          {(more.length > 0 || remove) && (
            <Menu>
              <MenuTrigger render={<Button type="button" variant="ghost" size="sm" className={barButton} />}>
                <MoreHorizontal />
                <span className="max-lg:sr-only">{pass.moreActions}</span>
              </MenuTrigger>
              <MenuContent side="top" align="end">
                {more.map(({ action, icon, label }) => (
                  <MenuItem key={label} onClick={action!.onClick}>
                    {icon}
                    {label}
                  </MenuItem>
                ))}
                {remove && more.length > 0 && <MenuSeparator />}
                {remove && (
                  <MenuItem className="text-destructive data-highlighted:text-destructive" onClick={remove.onClick}>
                    <Trash2 />
                    {t.common.delete}
                  </MenuItem>
                )}
              </MenuContent>
            </Menu>
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
