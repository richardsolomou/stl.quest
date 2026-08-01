import { useEffect, useMemo, useState } from 'react'
import { Plus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Field, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import type { PrintGroup, PrintGroupColor } from '../../core/types'
import { printGroupColors } from '../../core/types'
import { DialogProblem } from './DialogProblem'
import { DialogShell } from './DialogShell'
import { tagPath } from './TagPickerDialog'

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
  onSave: (id: string, fields: { name: string; color: PrintGroupColor; parentId: string | null }) => void
  onCreate: (name: string, parentId?: string) => Promise<string | undefined>
  onDelete: (tag: PrintGroup) => void
  onCancel: () => void
}) {
  const sorted = useMemo(() => tags.slice().sort((left, right) => tagPath(tags, left.id).localeCompare(tagPath(tags, right.id))), [tags])
  const [id, setId] = useState(sorted[0]?.id ?? '')
  const selected = tags.find((tag) => tag.id === id)
  const [name, setName] = useState(selected?.name ?? '')
  const [color, setColor] = useState<PrintGroupColor>(selected?.color ?? 'blue')
  const [parentId, setParentId] = useState(selected?.parentId ?? '')
  const [creating, setCreating] = useState(tags.length === 0)
  const [newName, setNewName] = useState('')
  const [newParentId, setNewParentId] = useState('')
  useEffect(() => {
    setName(selected?.name ?? '')
    setColor(selected?.color ?? 'blue')
    setParentId(selected?.parentId ?? '')
  }, [selected])
  return (
    <DialogShell
      title="Manage tags"
      description="Create, rename, recolor, or reorganize tags globally."
      onClose={onCancel}
      preventClose={pending}
    >
      {creating ? (
        <form
          className="space-y-4"
          onSubmit={async (event) => {
            event.preventDefault()
            if (!newName.trim()) return
            const createdId = await onCreate(newName.trim(), newParentId || undefined)
            if (createdId) {
              setId(createdId)
              setNewName('')
              setNewParentId('')
              setCreating(false)
            }
          }}
        >
          <Field>
            <FieldLabel htmlFor="new-tag-name">Name</FieldLabel>
            <Input id="new-tag-name" value={newName} onChange={(event) => setNewName(event.target.value)} placeholder="e.g. Build plates" />
          </Field>
          <Field>
            <FieldLabel htmlFor="new-tag-parent">Parent</FieldLabel>
            <select
              id="new-tag-parent"
              className="h-9 w-full rounded-md border bg-background px-3 text-sm"
              value={newParentId}
              onChange={(event) => setNewParentId(event.target.value)}
            >
              <option value="">Top level</option>
              {sorted.map((tag) => (
                <option key={tag.id} value={tag.id}>
                  {tagPath(tags, tag.id)}
                </option>
              ))}
            </select>
          </Field>
          <DialogProblem title="The tag was not created" hint="Nothing changed. Try again." error={error} />
          <div className="flex justify-end gap-2">
            {tags.length > 0 && (
              <Button type="button" variant="outline" disabled={pending} onClick={() => setCreating(false)}>
                Cancel
              </Button>
            )}
            <Button type="submit" disabled={pending || !newName.trim()}>
              <Plus />
              {pending ? 'Creating…' : 'Create tag'}
            </Button>
          </div>
        </form>
      ) : selected ? (
        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault()
            if (name.trim()) onSave(selected.id, { name: name.trim(), color, parentId: parentId || null })
          }}
        >
          <Field>
            <FieldLabel htmlFor="managed-tag">Tag</FieldLabel>
            <select
              id="managed-tag"
              className="h-9 w-full rounded-md border bg-background px-3 text-sm"
              value={id}
              onChange={(event) => setId(event.target.value)}
            >
              {sorted.map((tag) => (
                <option key={tag.id} value={tag.id}>
                  {tagPath(tags, tag.id)}
                </option>
              ))}
            </select>
          </Field>
          <Field>
            <FieldLabel htmlFor="managed-tag-name">Name</FieldLabel>
            <Input id="managed-tag-name" value={name} onChange={(event) => setName(event.target.value)} />
          </Field>
          <Field>
            <FieldLabel htmlFor="managed-tag-parent">Parent</FieldLabel>
            <select
              id="managed-tag-parent"
              className="h-9 w-full rounded-md border bg-background px-3 text-sm"
              value={parentId}
              onChange={(event) => setParentId(event.target.value)}
            >
              <option value="">Top level</option>
              {sorted
                .filter((tag) => tag.id !== selected.id)
                .map((tag) => (
                  <option key={tag.id} value={tag.id}>
                    {tagPath(tags, tag.id)}
                  </option>
                ))}
            </select>
          </Field>
          <Field>
            <FieldLabel htmlFor="managed-tag-color">Color</FieldLabel>
            <select
              id="managed-tag-color"
              className="h-9 w-full rounded-md border bg-background px-3 text-sm"
              value={color}
              onChange={(event) => setColor(event.target.value as PrintGroupColor)}
            >
              {printGroupColors.map((candidate) => (
                <option key={candidate} value={candidate}>
                  {candidate}
                </option>
              ))}
            </select>
          </Field>
          <DialogProblem title="The tag was not updated" hint="Nothing changed. Try again." error={error} />
          <div className="flex justify-between gap-2">
            <Button type="button" variant="destructive" disabled={pending} onClick={() => onDelete(selected)}>
              Delete tag
            </Button>
            <div className="flex gap-2">
              <Button type="button" variant="outline" disabled={pending} onClick={() => setCreating(true)}>
                <Plus />
                New tag
              </Button>
              <Button type="button" variant="outline" disabled={pending} onClick={onCancel}>
                Cancel
              </Button>
              <Button type="submit" disabled={pending || !name.trim()}>
                {pending ? 'Saving…' : 'Save'}
              </Button>
            </div>
          </div>
        </form>
      ) : (
        <div className="space-y-4">
          <p className="text-sm text-muted-foreground">No tags are available.</p>
          <div className="flex justify-end">
            <Button type="button" variant="outline" onClick={onCancel}>
              Close
            </Button>
          </div>
        </div>
      )}
    </DialogShell>
  )
}
