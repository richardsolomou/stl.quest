import { useEffect, useMemo, useRef, useState } from 'react'
import { combine } from '@atlaskit/pragmatic-drag-and-drop/combine'
import { draggable, dropTargetForElements } from '@atlaskit/pragmatic-drag-and-drop/element/adapter'
import { attachClosestEdge, extractClosestEdge, type Edge } from '@atlaskit/pragmatic-drag-and-drop-hitbox/closest-edge'
import { ArrowLeft, GripVertical, Pencil, Plus, Tags, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty'
import { Field, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Item, ItemActions, ItemContent, ItemGroup, ItemMedia, ItemTitle } from '@/components/ui/item'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Spinner } from '@/components/ui/spinner'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import { MAX_PRINT_GROUP_NAME_LENGTH, printGroupBranchIds, printGroupRows, type PrintGroupRow } from '../../core/printGroups'
import { printGroupColors, type PrintGroup, type PrintGroupColor } from '../../core/types'
import { ConfirmDialog } from './ConfirmDialog'
import { DialogProblem } from './DialogProblem'
import { DialogShell } from './DialogShell'
import { TagDot } from './TagBadge'
import { TagParentSelect } from './TagParentSelect'

type View = { mode: 'list' } | { mode: 'create' } | { mode: 'edit'; id: string }

const INDENT_BASE = 12
const INDENT_STEP = 16

export function ManageTagsDialog({
  tags,
  pending,
  error,
  onSave,
  onCreate,
  onDelete,
  onCancel,
}: {
  tags: PrintGroup[]
  pending: boolean
  error?: string
  onSave: (id: string, fields: { name: string; color: PrintGroupColor; parentId: string | null }) => Promise<boolean>
  onCreate: (name: string, parentId?: string) => Promise<string | undefined>
  onDelete: (tag: PrintGroup) => void
  onCancel: () => void
}) {
  const rows = useMemo(() => printGroupRows(tags), [tags])
  const [view, setView] = useState<View>({ mode: 'list' })
  const [deleting, setDeleting] = useState<PrintGroup | null>(null)
  const editing = view.mode === 'edit' ? rows.find((row) => row.group.id === view.id) : undefined
  const deletingBranch = deleting ? printGroupBranchIds(tags, deleting.id).size - 1 : 0

  // Nesting a tag under itself or under its own descendant would create a cycle.
  const canReparent = (sourceId: string, parentId: string | null) =>
    parentId === null || (sourceId !== parentId && !printGroupBranchIds(tags, sourceId).has(parentId))

  const reparent = (sourceId: string, parentId: string | null) => {
    const source = tags.find((tag) => tag.id === sourceId)
    if (!source || (source.parentId ?? null) === parentId) return
    void onSave(sourceId, { name: source.name, color: source.color, parentId })
  }

  return (
    <>
      <DialogShell
        title="Manage tags"
        description="Tags apply across every stage, so renaming or moving one updates it everywhere. Drag a tag next to another to move it there, or further right to nest it underneath."
        onClose={onCancel}
        preventClose={pending}
      >
        {view.mode === 'create' ? (
          <TagForm
            rows={rows}
            pending={pending}
            error={error}
            submitLabel="Create tag"
            onSubmit={async ({ name, parentId }) => {
              const id = await onCreate(name, parentId || undefined)
              if (id) setView({ mode: 'list' })
            }}
            onBack={() => setView({ mode: 'list' })}
          />
        ) : editing ? (
          <TagForm
            key={editing.group.id}
            rows={rows}
            tag={editing.group}
            pending={pending}
            error={error}
            submitLabel="Save tag"
            onSubmit={async ({ name, color, parentId }) => {
              const saved = await onSave(editing.group.id, { name, color, parentId: parentId || null })
              if (saved) onCancel()
            }}
            onBack={() => setView({ mode: 'list' })}
          />
        ) : (
          <div className="space-y-3">
            {rows.length === 0 ? (
              <Empty>
                <EmptyHeader>
                  <EmptyMedia variant="icon">
                    <Tags />
                  </EmptyMedia>
                  <EmptyTitle>No tags yet</EmptyTitle>
                  <EmptyDescription>Tags group prints across stages, such as a build plate or a customer order.</EmptyDescription>
                </EmptyHeader>
                <EmptyContent>
                  <Button type="button" onClick={() => setView({ mode: 'create' })}>
                    <Plus />
                    New tag
                  </Button>
                </EmptyContent>
              </Empty>
            ) : (
              <ItemGroup>
                {rows.map((row) => (
                  <TagRow
                    key={row.group.id}
                    row={row}
                    pending={pending}
                    canDrop={canReparent}
                    onReparent={reparent}
                    onEdit={() => setView({ mode: 'edit', id: row.group.id })}
                    onDelete={() => setDeleting(row.group)}
                  />
                ))}
              </ItemGroup>
            )}
            <DialogProblem title="The tags were not updated" hint="Nothing changed. Try again." error={error} />
            {rows.length > 0 && (
              <div className="flex justify-end gap-2">
                <Button type="button" variant="outline" disabled={pending} onClick={() => setView({ mode: 'create' })}>
                  <Plus />
                  New tag
                </Button>
                <Button type="button" disabled={pending} onClick={onCancel}>
                  Done
                </Button>
              </div>
            )}
          </div>
        )}
      </DialogShell>
      <ConfirmDialog
        open={deleting !== null}
        title={`Delete “${deleting?.name ?? ''}”?`}
        description={
          deletingBranch > 0
            ? `This also deletes ${deletingBranch} nested ${deletingBranch === 1 ? 'tag' : 'tags'}. Every print keeps its place on the board.`
            : 'Prints lose this tag but keep their place on the board.'
        }
        confirmLabel="Delete tag"
        destructive
        pending={pending}
        onConfirm={() => {
          if (deleting) onDelete(deleting)
          setDeleting(null)
          setView({ mode: 'list' })
        }}
        onCancel={() => setDeleting(null)}
      />
    </>
  )
}

/**
 * A single row in the flattened tag tree. Dropping near another row (top or bottom half) makes the
 * dragged tag its sibling — including becoming top-level, when dropped near a top-level row — while
 * dropping further to the right nests it as that row's child. The edit form's select is gone in favor
 * of this being the only way to reparent an existing tag.
 */
function TagRow({
  row,
  pending,
  canDrop,
  onReparent,
  onEdit,
  onDelete,
}: {
  row: PrintGroupRow
  pending: boolean
  canDrop: (sourceId: string, parentId: string | null) => boolean
  onReparent: (sourceId: string, parentId: string | null) => void
  onEdit: () => void
  onDelete: () => void
}) {
  const ref = useRef<HTMLDivElement>(null)
  const [dragging, setDragging] = useState(false)
  const [nesting, setNesting] = useState(false)
  const [dropEdge, setDropEdge] = useState<Edge | null>(null)

  useEffect(() => {
    const element = ref.current
    if (!element || pending) return

    // Past the next indent step, further right than this row's own content, means "nest under this row".
    const resolveTarget = (sourceId: string, clientX: number) => {
      const contentStart = element.getBoundingClientRect().left + INDENT_BASE + Math.min(row.depth, 4) * INDENT_STEP
      if (clientX > contentStart + INDENT_STEP && canDrop(sourceId, row.group.id)) return row.group.id
      const siblingParentId = row.group.parentId ?? null
      return canDrop(sourceId, siblingParentId) ? siblingParentId : undefined
    }

    return combine(
      draggable({
        element,
        getInitialData: () => ({ type: 'tag', id: row.group.id }),
        onDragStart: () => setDragging(true),
        onDrop: () => setDragging(false),
      }),
      dropTargetForElements({
        element,
        getData: ({ input, element: el }) =>
          attachClosestEdge({ type: 'tag', id: row.group.id }, { input, element: el, allowedEdges: ['top', 'bottom'] }),
        canDrop: ({ source, input }) =>
          source.data.type === 'tag' && typeof source.data.id === 'string' && resolveTarget(source.data.id, input.clientX) !== undefined,
        onDrag: ({ source, location, self }) => {
          if (typeof source.data.id !== 'string') return
          const target = resolveTarget(source.data.id, location.current.input.clientX)
          setNesting(target === row.group.id)
          setDropEdge(target !== undefined && target !== row.group.id ? extractClosestEdge(self.data) : null)
        },
        onDragLeave: () => {
          setNesting(false)
          setDropEdge(null)
        },
        onDrop: ({ source, location }) => {
          setNesting(false)
          setDropEdge(null)
          if (typeof source.data.id !== 'string') return
          const target = resolveTarget(source.data.id, location.current.input.clientX)
          if (target !== undefined) onReparent(source.data.id, target)
        },
      }),
    )
  }, [pending, row.group.id, row.group.parentId, row.depth, canDrop, onReparent])

  return (
    <Item
      ref={ref}
      variant="outline"
      size="sm"
      className={cn(
        'relative transition-[opacity,box-shadow]',
        dragging && 'opacity-40',
        nesting && 'border-primary bg-primary/5 ring-2 ring-primary/25',
      )}
      // Indenting with padding keeps deeply nested rows inside the dialog on a narrow screen.
      style={{ paddingInlineStart: INDENT_BASE + Math.min(row.depth, 4) * INDENT_STEP }}
    >
      {dropEdge && (
        <span
          aria-hidden="true"
          className={cn(
            'pointer-events-none absolute inset-x-2 z-10 h-0.5 rounded-full bg-primary',
            dropEdge === 'top' ? 'bottom-full -translate-y-px' : 'top-full translate-y-px',
          )}
        />
      )}
      <ItemMedia
        className={cn(pending ? 'cursor-not-allowed text-muted-foreground/40' : 'cursor-grab text-muted-foreground')}
        aria-hidden="true"
        title="Drag to reorder, or further right to nest under another tag"
      >
        <GripVertical />
      </ItemMedia>
      <ItemMedia>
        <TagDot color={row.group.color} />
      </ItemMedia>
      <ItemContent className="min-w-0">
        <ItemTitle>{row.group.name}</ItemTitle>
      </ItemContent>
      <ItemActions>
        <Tooltip>
          <TooltipTrigger
            render={
              <Button type="button" variant="ghost" size="icon-sm" aria-label={`Edit ${row.path}`} disabled={pending} onClick={onEdit} />
            }
          >
            <Pencil />
          </TooltipTrigger>
          <TooltipContent>Edit tag</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                aria-label={`Delete ${row.path}`}
                disabled={pending}
                onClick={onDelete}
              />
            }
          >
            <Trash2 />
          </TooltipTrigger>
          <TooltipContent>Delete tag</TooltipContent>
        </Tooltip>
      </ItemActions>
    </Item>
  )
}

function TagForm({
  tag,
  rows,
  pending,
  error,
  submitLabel,
  onSubmit,
  onBack,
}: {
  tag?: PrintGroup
  rows: PrintGroupRow[]
  pending: boolean
  error?: string
  submitLabel: string
  onSubmit: (fields: { name: string; color: PrintGroupColor; parentId: string }) => void | Promise<void>
  onBack: () => void
}) {
  const [name, setName] = useState(tag?.name ?? '')
  const [color, setColor] = useState<PrintGroupColor>(tag?.color ?? 'blue')
  const [parentId, setParentId] = useState(tag?.parentId ?? '')

  return (
    <form
      className="space-y-4"
      onSubmit={(event) => {
        event.preventDefault()
        if (name.trim()) void onSubmit({ name: name.trim(), color, parentId })
      }}
    >
      <Field>
        <FieldLabel htmlFor="tag-name">Name</FieldLabel>
        <Input
          id="tag-name"
          maxLength={MAX_PRINT_GROUP_NAME_LENGTH}
          value={name}
          placeholder="e.g. Plate 14"
          onChange={(event) => setName(event.target.value)}
        />
      </Field>
      {!tag && (
        <Field>
          <FieldLabel htmlFor="tag-parent">Parent</FieldLabel>
          <TagParentSelect
            id="tag-parent"
            value={parentId}
            rows={rows}
            disabled={pending}
            ariaLabel="Parent"
            className="w-full"
            onChange={setParentId}
          />
        </Field>
      )}
      {tag && (
        <Field>
          <FieldLabel htmlFor="tag-color">Color</FieldLabel>
          <Select
            items={printGroupColors.map((value) => ({ value, label: value }))}
            value={color}
            disabled={pending}
            onValueChange={(next: PrintGroupColor | null) => next && setColor(next)}
          >
            <SelectTrigger id="tag-color" aria-label="Color" className="w-full capitalize">
              <TagDot color={color} />
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {printGroupColors.map((candidate) => (
                <SelectItem key={candidate} value={candidate} className="capitalize">
                  <TagDot color={candidate} />
                  {candidate}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
      )}
      <DialogProblem title="The tag was not saved" hint="Nothing changed. Try again." error={error} />
      <div className="flex justify-end gap-2">
        <Button type="button" variant="outline" disabled={pending} onClick={onBack}>
          <ArrowLeft />
          Back
        </Button>
        <Button type="submit" disabled={pending || !name.trim()}>
          {pending && <Spinner />}
          {pending ? 'Saving…' : submitLabel}
        </Button>
      </div>
    </form>
  )
}
