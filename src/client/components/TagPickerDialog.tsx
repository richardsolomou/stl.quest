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
import { MAX_PRINT_GROUP_NAME_LENGTH, parsePrintGroupPath, printGroupRows } from '../../core/printGroups'
import type { PrintGroup } from '../../core/types'
import { DialogProblem } from './DialogProblem'
import { DialogShell } from './DialogShell'
import { TagDot } from './TagBadge'

type TagOption = { value: string; label: string; group: PrintGroup }

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
  const rows = useMemo(() => printGroupRows(tags), [tags])
  const options = useMemo<TagOption[]>(() => rows.map((row) => ({ value: row.group.id, label: row.path, group: row.group })), [rows])
  const selected = options.filter((option) => selectedTagIds.has(option.value))
  const draft = parsePrintGroupPath(query, rows)

  return (
    <DialogShell
      title="Tag prints"
      description="Tags stay attached to these copies as they move between stages. Type a path such as “Build plates / Plate 14” to nest a new one."
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
            inputValue={query}
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
                <ComboboxChip key={option.value}>
                  <TagDot color={option.group.color} className="size-1.5" />
                  {option.label}
                </ComboboxChip>
              ))}
              <ComboboxChipsInput
                id="tag-search"
                aria-label="Find or create tags"
                maxLength={MAX_PRINT_GROUP_NAME_LENGTH}
                placeholder="Find or create tags…"
              />
            </ComboboxChips>
            <ComboboxContent anchor={anchor}>
              <ComboboxEmpty>No matching tags.</ComboboxEmpty>
              <ComboboxList>
                <ComboboxCollection>
                  {(option: TagOption) => (
                    <ComboboxItem key={option.value} value={option}>
                      <TagDot color={option.group.color} />
                      <span className="truncate">{option.label}</span>
                    </ComboboxItem>
                  )}
                </ComboboxCollection>
              </ComboboxList>
              {draft.creatable && (
                <div className="border-t p-1">
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="w-full justify-start"
                    disabled={pending}
                    onClick={() => {
                      setQuery('')
                      onCreate(draft.name, draft.parent?.group.id)
                    }}
                  >
                    <Plus />
                    <span className="truncate">Create “{draft.path}”</span>
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
