import { Plus, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Item, ItemContent, ItemMedia } from '@/components/ui/item'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { cn } from '@/lib/utils'
import type { PrintType } from '../../core/types'
import type { UploadEntry } from './uploadTypes'
import { printTypeLabel } from '../fleet'

export function UploadRow({
  entry,
  onPatch,
  onRemove,
  printTypes,
}: {
  entry: UploadEntry
  onPatch: (patch: Partial<UploadEntry>) => void
  onRemove: () => void
  printTypes: readonly PrintType[]
}) {
  return (
    <Item variant="muted" className={cn('items-start max-sm:flex-col', entry.state === 'error' && 'ring-1 ring-destructive')}>
      <ItemMedia className="grid size-12 place-items-center overflow-hidden rounded-md border bg-background [background-image:var(--grid)] [background-size:12px_12px] max-sm:size-16">
        {entry.thumbnail ? (
          <img className="size-full object-contain" src={entry.thumbnail} alt="" />
        ) : (
          <span className="font-mono text-[10px] text-muted-foreground">stl</span>
        )}
      </ItemMedia>
      <ItemContent className="min-w-0 gap-1.5 max-sm:w-full">
        <div className="grid grid-cols-[minmax(0,1fr)_4rem_auto] items-center gap-2 max-sm:grid-cols-[minmax(0,1fr)_auto]">
          <Input
            aria-label="Name"
            value={entry.name}
            onChange={(event) => onPatch({ name: event.target.value })}
            maxLength={120}
            required
            disabled={entry.state === 'done'}
          />
          <Input
            aria-label="Copies"
            className="w-16 shrink-0 max-sm:row-start-2"
            type="number"
            inputMode="numeric"
            min={1}
            max={50}
            value={entry.quantity}
            onChange={(event) => onPatch({ quantity: event.target.value })}
            disabled={entry.state === 'done'}
          />
          {entry.state === 'done' ? (
            <span className="shrink-0 font-mono text-sm text-[var(--chart-2)] max-sm:col-start-2 max-sm:row-start-2">added</span>
          ) : (
            <Tooltip>
              <TooltipTrigger
                render={
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    className="shrink-0 text-muted-foreground hover:text-destructive max-sm:col-start-2 max-sm:row-start-1"
                    aria-label={`Remove ${entry.name}`}
                    onClick={onRemove}
                  />
                }
              >
                <X />
              </TooltipTrigger>
              <TooltipContent>Remove print</TooltipContent>
            </Tooltip>
          )}
        </div>
        {printTypes.length > 1 && (
          <Select
            items={printTypes.map((printType) => ({ value: printType, label: printTypeLabel(printType) }))}
            value={entry.printType}
            onValueChange={(printType) => onPatch({ printType: printType ?? '' })}
            disabled={entry.state === 'done'}
          >
            <SelectTrigger className="w-full" aria-label={`Print type for ${entry.name}`}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {printTypes.map((printType) => (
                <SelectItem key={printType} value={printType}>
                  {printTypeLabel(printType)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
        {entry.noteOpen && (
          <div className="flex items-start gap-2">
            <Textarea
              aria-label="Notes"
              rows={2}
              value={entry.notes}
              onChange={(event) => onPatch({ notes: event.target.value })}
              placeholder="scale, supports, colour — anything the printer should know"
              disabled={entry.state === 'done'}
            />
            {entry.state === 'pending' && (
              <Tooltip>
                <TooltipTrigger
                  render={
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      className="shrink-0 text-muted-foreground hover:text-destructive"
                      aria-label="Remove note"
                      onClick={() => onPatch({ noteOpen: false, notes: '' })}
                    />
                  }
                >
                  <X />
                </TooltipTrigger>
                <TooltipContent>Remove note</TooltipContent>
              </Tooltip>
            )}
          </div>
        )}
        {entry.linkOpen && (
          <div className="flex items-start gap-2">
            <Input
              aria-label="Source URL"
              type="url"
              inputMode="url"
              value={entry.sourceUrl}
              onChange={(event) => onPatch({ sourceUrl: event.target.value })}
              placeholder="https://… where this model came from"
              maxLength={500}
              disabled={entry.state === 'done'}
            />
            {entry.state === 'pending' && (
              <Tooltip>
                <TooltipTrigger
                  render={
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      className="shrink-0 text-muted-foreground hover:text-destructive"
                      aria-label="Remove link"
                      onClick={() => onPatch({ linkOpen: false, sourceUrl: '' })}
                    />
                  }
                >
                  <X />
                </TooltipTrigger>
                <TooltipContent>Remove link</TooltipContent>
              </Tooltip>
            )}
          </div>
        )}
        {entry.state === 'pending' && (!entry.noteOpen || !entry.linkOpen) && (
          <div className="grid gap-1 sm:flex sm:flex-wrap sm:gap-x-3">
            {!entry.noteOpen && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-8 w-full justify-start px-2 text-xs text-muted-foreground sm:h-auto sm:w-auto sm:px-0"
                onClick={() => onPatch({ noteOpen: true })}
              >
                <Plus />
                Add note
              </Button>
            )}
            {!entry.linkOpen && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-8 w-full justify-start px-2 text-xs text-muted-foreground sm:h-auto sm:w-auto sm:px-0"
                onClick={() => onPatch({ linkOpen: true })}
              >
                <Plus />
                Add link
              </Button>
            )}
          </div>
        )}
      </ItemContent>
    </Item>
  )
}
