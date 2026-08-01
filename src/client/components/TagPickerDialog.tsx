import { useMemo, useState } from 'react'
import { Plus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Combobox,
  ComboboxChip,
  ComboboxChips,
  ComboboxChipsInput,
  ComboboxCollection,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxItem,
  ComboboxList,
  useComboboxAnchor,
} from '@/components/ui/combobox'
import { Field, FieldLabel } from '@/components/ui/field'
import type { PrintGroup } from '../../core/types'
import { DialogProblem } from './DialogProblem'
import { DialogShell } from './DialogShell'

type TagOption = { value: string; label: string }

export function TagPickerDialog({
  tags,
  pending,
  error,
  selectedTagIds,
  onToggle,
  onCreate,
  onCancel,
}: {
  tags: PrintGroup[]
  pending: boolean
  error?: string
  selectedTagIds: Set<string>
  onToggle: (tagId: string, selected: boolean) => void
  onCreate: (name: string, parentId?: string) => void
  onCancel: () => void
}) {
  const anchor = useComboboxAnchor()
  const [query, setQuery] = useState('')
  const [parentId, setParentId] = useState('')
  const options = useMemo<TagOption[]>(
    () => tags.map((tag) => ({ value: tag.id, label: tagPath(tags, tag.id) })).sort((left, right) => left.label.localeCompare(right.label)),
    [tags],
  )
  const selected = options.filter((option) => selectedTagIds.has(option.value))
  const name = query.trim()
  const canCreate = name && !options.some((option) => option.label.toLocaleLowerCase() === name.toLocaleLowerCase())

  return (
    <DialogShell
      title="Manage tags"
      description="Search, select, or create tags that stay attached as copies move between stages."
      onClose={onCancel}
      preventClose={pending}
    >
      <div className="space-y-4">
        <Field>
          <FieldLabel htmlFor="tag-search">Tags</FieldLabel>
          <Combobox
            multiple
            items={options}
            value={selected}
            disabled={pending}
            onInputValueChange={setQuery}
            onValueChange={(next: TagOption[]) => {
              const nextIds = new Set(next.map((option) => option.value))
              for (const option of options) {
                if (nextIds.has(option.value) !== selectedTagIds.has(option.value)) {
                  onToggle(option.value, nextIds.has(option.value))
                }
              }
            }}
          >
            <ComboboxChips ref={anchor}>
              {selected.map((option) => (
                <ComboboxChip key={option.value}>{option.label}</ComboboxChip>
              ))}
              <ComboboxChipsInput id="tag-search" aria-label="Find or create tags" placeholder="Find or create tags…" />
            </ComboboxChips>
            <ComboboxContent anchor={anchor}>
              <ComboboxEmpty>No matching tags.</ComboboxEmpty>
              <ComboboxList>
                <ComboboxCollection>
                  {(option: TagOption) => (
                    <ComboboxItem key={option.value} value={option}>
                      {option.label}
                    </ComboboxItem>
                  )}
                </ComboboxCollection>
              </ComboboxList>
              {canCreate && (
                <div className="border-t p-2">
                  <Field>
                    <FieldLabel htmlFor="tag-parent">Create under</FieldLabel>
                    <select
                      id="tag-parent"
                      className="h-9 w-full rounded-md border bg-background px-3 text-sm"
                      value={parentId}
                      onChange={(event) => setParentId(event.target.value)}
                    >
                      <option value="">Top level</option>
                      {options.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <Button
                    type="button"
                    className="mt-2 w-full"
                    disabled={pending}
                    onClick={() => {
                      setQuery('')
                      onCreate(name, parentId || undefined)
                    }}
                  >
                    <Plus />
                    Create “{name}”
                  </Button>
                </div>
              )}
            </ComboboxContent>
          </Combobox>
        </Field>
        <DialogProblem title="The tags were not updated" hint="Nothing changed. Try again." error={error} />
        <div className="flex justify-end">
          <Button type="button" disabled={pending} onClick={onCancel}>
            Done
          </Button>
        </div>
      </div>
    </DialogShell>
  )
}

export function tagPath(tags: PrintGroup[], id: string) {
  const names: string[] = []
  const visited = new Set<string>()
  let tag = tags.find((candidate) => candidate.id === id)
  while (tag && !visited.has(tag.id)) {
    visited.add(tag.id)
    names.unshift(tag.name)
    tag = tag.parentId ? tags.find((candidate) => candidate.id === tag!.parentId) : undefined
  }
  return names.join(' / ')
}
