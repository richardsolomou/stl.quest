import { useVirtualizer } from '@tanstack/react-virtual'
import { ChevronDown, ChevronRight, Plus, Search, Settings2 } from 'lucide-react'
import { useMemo, useRef, useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { filterPrinterPresets, PRINTER_PRESETS, type PrinterPreset } from '../../../core/printerPresets'
import { PrinterPresetImage } from './PrinterPresetImage'

export function PrinterPresetPicker({
  disabled,
  onSelect,
  onCustom,
}: {
  disabled?: boolean
  onSelect: (preset: PrinterPreset) => void
  onCustom: () => void
}) {
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')
  const [expandedBrand, setExpandedBrand] = useState<string | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const results = useMemo(() => filterPrinterPresets(search), [search])
  const resultRows = useMemo(() => pairPresets(results), [results])
  const groups = useMemo(() => groupPresets(PRINTER_PRESETS), [])
  const searching = !!search.trim()
  const virtualizer = useVirtualizer({
    count: searching ? resultRows.length : 0,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 88,
    overscan: 8,
  })
  const choose = (action: () => void) => {
    action()
    setOpen(false)
    setSearch('')
    setExpandedBrand(null)
  }

  return (
    <>
      <Button type="button" variant="outline" className="justify-self-start" onClick={() => setOpen(true)} disabled={disabled}>
        <Plus /> Add printer
      </Button>
      <Dialog
        open={open}
        onOpenChange={(next) => {
          setOpen(next)
          if (!next) {
            setSearch('')
            setExpandedBrand(null)
          }
        }}
      >
        <DialogContent className="max-h-[min(44rem,calc(100dvh-2rem))] grid-rows-[auto_auto_minmax(0,1fr)] sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Choose a printer</DialogTitle>
            <DialogDescription>Select a predefined model or start with an editable custom profile.</DialogDescription>
          </DialogHeader>
          <div className="relative">
            <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              aria-label="Search printers"
              placeholder="Search by brand, model, or print type"
              value={search}
              className="pl-9"
              onChange={(event) => setSearch(event.target.value)}
            />
          </div>
          <div ref={scrollRef} className="min-h-0 overflow-y-auto pr-1">
            {searching ? (
              results.length ? (
                <div className="relative" style={{ height: virtualizer.getTotalSize() }}>
                  {virtualizer.getVirtualItems().map((row) => {
                    const presets = resultRows[row.index]
                    return (
                      <div
                        key={presets.map((preset) => preset.id).join(':')}
                        ref={virtualizer.measureElement}
                        data-index={row.index}
                        className="absolute top-0 left-0 w-full py-1"
                        style={{ transform: `translateY(${row.start}px)` }}
                      >
                        <div className="grid min-h-20 grid-cols-2 gap-2">
                          {presets.map((preset) => (
                            <PresetButton key={preset.id} preset={preset} onClick={() => choose(() => onSelect(preset))} showBrand />
                          ))}
                        </div>
                      </div>
                    )
                  })}
                </div>
              ) : (
                <p className="py-10 text-center text-sm text-muted-foreground">No predefined printers match “{search.trim()}”.</p>
              )
            ) : (
              <div className="grid gap-3 pb-1">
                <button
                  type="button"
                  className="flex w-full items-center gap-3 rounded-lg border p-3 text-left transition-colors hover:bg-muted/60 focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
                  onClick={() => choose(onCustom)}
                >
                  <span className="flex size-14 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
                    <Settings2 className="size-6" />
                  </span>
                  <span>
                    <span className="block font-medium">Custom printer</span>
                    <span className="block text-sm text-muted-foreground">Enter the print type and usable build volume manually.</span>
                  </span>
                </button>
                <div className="grid gap-2">
                  {groups.map(([brand, presets]) => {
                    const expanded = expandedBrand === brand
                    return (
                      <section key={brand} className="overflow-hidden rounded-lg border">
                        <button
                          type="button"
                          className="flex w-full items-center gap-3 px-3 py-3 text-left transition-colors hover:bg-muted/60 focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
                          aria-expanded={expanded}
                          onClick={() => setExpandedBrand(expanded ? null : brand)}
                        >
                          {expanded ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}
                          <span className="font-medium">{brand}</span>
                          <Badge variant="secondary" className="ml-auto">
                            {presets.length}
                          </Badge>
                        </button>
                        {expanded && (
                          <div className="grid gap-2 border-t bg-muted/15 p-2 sm:grid-cols-2">
                            {presets.map((preset) => (
                              <PresetButton key={preset.id} preset={preset} onClick={() => choose(() => onSelect(preset))} />
                            ))}
                          </div>
                        )}
                      </section>
                    )
                  })}
                </div>
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </>
  )
}

function PresetButton({ preset, onClick, showBrand = false }: { preset: PrinterPreset; onClick: () => void; showBrand?: boolean }) {
  return (
    <button
      type="button"
      className="flex h-full w-full min-w-0 items-center gap-3 rounded-lg border bg-background p-2.5 text-left transition-colors hover:bg-muted/60 focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
      aria-label={`Add ${preset.brand} ${preset.model}`}
      onClick={onClick}
    >
      <PrinterPresetImage printer={preset} />
      <span className="min-w-0">
        <span className="flex min-w-0 items-center gap-2">
          <span className="truncate font-medium">{showBrand ? `${preset.brand} ${preset.model}` : preset.model}</span>
          <Badge variant="outline" className="shrink-0 text-[0.65rem]">
            {preset.printType === 'resin' ? 'Resin' : 'Filament'}
          </Badge>
        </span>
        <span className="mt-1 block text-xs text-muted-foreground">
          {formatDimension(preset.widthMm)} × {formatDimension(preset.depthMm)} × {formatDimension(preset.heightMm)} mm
        </span>
      </span>
    </button>
  )
}

function groupPresets(presets: readonly PrinterPreset[]) {
  const groups = new Map<string, PrinterPreset[]>()
  for (const preset of presets) groups.set(preset.brand, [...(groups.get(preset.brand) ?? []), preset])
  return [...groups.entries()]
}

function pairPresets(presets: readonly PrinterPreset[]) {
  return Array.from({ length: Math.ceil(presets.length / 2) }, (_, index) => presets.slice(index * 2, index * 2 + 2))
}

function formatDimension(value: number) {
  return Number.isInteger(value) ? String(value) : String(Number(value.toFixed(2)))
}
