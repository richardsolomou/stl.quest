import { useState } from 'react'
import { ChevronDown, Layers3, Trash2, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { ConfirmDialog } from './ConfirmDialog'

export function BoardBulkActions({
  count,
  canPlan,
  deleting,
  onPlan,
  onDelete,
  onClear,
}: {
  count: number
  canPlan: boolean
  deleting: boolean
  onPlan: () => void
  onDelete: () => void
  onClear: () => void
}) {
  const [actionsOpen, setActionsOpen] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const requests = count === 1 ? 'request' : 'requests'

  return (
    <>
      <div className="flex items-center gap-1 rounded-md border bg-card p-1" aria-label="Bulk actions">
        <span className="px-2 text-xs text-muted-foreground">{count} selected</span>
        <Popover open={actionsOpen} onOpenChange={setActionsOpen}>
          <PopoverTrigger render={<Button type="button" variant="outline" size="sm" />}>
            Actions <ChevronDown />
          </PopoverTrigger>
          <PopoverContent align="end" className="w-48 gap-1 p-1">
            <Button
              type="button"
              variant="ghost"
              className="w-full justify-start"
              disabled={!canPlan}
              onClick={() => {
                setActionsOpen(false)
                onPlan()
              }}
            >
              <Layers3 /> Plan next
            </Button>
            <Button
              type="button"
              variant="destructive"
              className="w-full justify-start"
              disabled={deleting}
              onClick={() => {
                setActionsOpen(false)
                setDeleteOpen(true)
              }}
            >
              <Trash2 /> Delete {requests}
            </Button>
          </PopoverContent>
        </Popover>
        <Button type="button" variant="ghost" size="icon-sm" aria-label="Clear selection" onClick={onClear}>
          <X />
        </Button>
      </div>
      <ConfirmDialog
        open={deleteOpen}
        title={`Delete ${count} selected ${requests}?`}
        description="This permanently deletes the selected requests and their STL files."
        confirmLabel={`Delete ${requests}`}
        destructive
        onCancel={() => setDeleteOpen(false)}
        onConfirm={() => {
          setDeleteOpen(false)
          onDelete()
        }}
      />
    </>
  )
}
