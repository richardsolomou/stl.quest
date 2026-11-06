import { useEffect, useMemo, useRef, useState } from 'react'
import { Minus, Plus } from 'lucide-react'
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
import { Spinner } from '@/components/ui/spinner'
import { MAX_PRINT_GROUP_NAME_LENGTH, printGroupNameTaken, printGroupRows, validPrintGroupName } from '../../core/printGroups'
import type { PrintGroup, PrintGroupColor } from '../../core/types'
import { DialogProblem } from './DialogProblem'
import { DialogShell } from './DialogShell'
import { TagDot, TagTreeRow } from './TagBadge'
import { useI18n } from '../i18n'

type ExistingTagOption = { kind: 'tag'; value: string; label: string; depth: number; name: string; color: PrintGroupColor }
type CreateTagOption = { kind: 'create'; value: string; label: string; name: string }
type TagOption = ExistingTagOption | CreateTagOption

export function TagPickerDialog({
  tags,
  pending,
  error,
  selectedTagIds,
  partialTagIds,
  onToggle,
  onCreate,
  onCancel,
}: {
  tags: PrintGroup[]
  pending: boolean
  error?: string
  selectedTagIds: Set<string>
  /** Tags on some but not all of the copies being tagged; picking one adds it to the rest. */
  partialTagIds: Set<string>
  onToggle: (tagId: string, selected: boolean) => void
  onCreate: (name: string) => void
  onCancel: () => void
}) {
  const { t } = useI18n()
  const p = t.board.tagPicker
  const anchor = useComboboxAnchor()
  const inputRef = useRef<HTMLInputElement>(null)
  const restoreFocusRef = useRef(false)
  const [query, setQuery] = useState('')
  const highlightedRef = useRef(false)
  const rows = useMemo(() => printGroupRows(tags), [tags])
  const tagOptions = useMemo<ExistingTagOption[]>(
    () =>
      rows.map((row) => ({
        kind: 'tag',
        value: row.group.id,
        label: row.path,
        depth: row.depth,
        name: row.group.name,
        color: row.group.color,
      })),
    [rows],
  )
  const trimmed = query.trim()
  const canCreate = validPrintGroupName(trimmed) && !printGroupNameTaken(tags, trimmed)
  const options: TagOption[] = canCreate
    ? [...tagOptions, { kind: 'create', value: `create:${trimmed}`, label: p.create(trimmed), name: trimmed }]
    : tagOptions
  const selected = tagOptions.filter((option) => selectedTagIds.has(option.value))

  const createTag = (name: string) => {
    restoreFocusRef.current = true
    setQuery('')
    onCreate(name)
  }

  useEffect(() => {
    if (pending || !restoreFocusRef.current) return
    const frame = requestAnimationFrame(() => {
      if (inputRef.current?.disabled) return
      restoreFocusRef.current = false
      inputRef.current?.focus()
    })
    return () => cancelAnimationFrame(frame)
  }, [pending, selectedTagIds])

  return (
    <DialogShell title={p.title} description={p.description} onClose={onCancel} preventClose={pending}>
      <div className="space-y-4">
        <Field>
          <FieldLabel htmlFor="tag-search">{p.label}</FieldLabel>
          <Combobox
            multiple
            items={options}
            value={selected}
            disabled={pending}
            inputValue={query}
            onInputValueChange={setQuery}
            onItemHighlighted={(item) => {
              highlightedRef.current = item !== undefined
            }}
            onValueChange={(next: TagOption[]) => {
              const create = next.find((option) => option.kind === 'create')
              if (create) {
                createTag(create.name)
                return
              }
              const nextIds = new Set(next.map((option) => option.value))
              for (const option of tagOptions) {
                if (nextIds.has(option.value) !== selectedTagIds.has(option.value)) {
                  restoreFocusRef.current = true
                  onToggle(option.value, nextIds.has(option.value))
                }
              }
            }}
          >
            <ComboboxChips ref={anchor}>
              {selected.map((option) => (
                <ComboboxChip key={option.value} title={option.label}>
                  <TagDot color={option.color} className="size-1.5" />
                  {option.name}
                </ComboboxChip>
              ))}
              <ComboboxChipsInput
                ref={inputRef}
                id="tag-search"
                aria-label={p.search}
                maxLength={MAX_PRINT_GROUP_NAME_LENGTH}
                placeholder={p.searchPlaceholder}
                onKeyDown={(event) => {
                  if (event.key !== 'Enter' || highlightedRef.current || !trimmed) return
                  const exact = tagOptions.find((option) => option.name.trim().toLocaleLowerCase() === trimmed.toLocaleLowerCase())
                  if (exact) {
                    restoreFocusRef.current = true
                    setQuery('')
                    if (!selectedTagIds.has(exact.value)) onToggle(exact.value, true)
                    return
                  }
                  if (canCreate) createTag(trimmed)
                }}
              />
            </ComboboxChips>
            <ComboboxContent anchor={anchor}>
              <ComboboxEmpty>{p.empty}</ComboboxEmpty>
              <ComboboxList>
                <ComboboxCollection>
                  {(option: TagOption) =>
                    option.kind === 'create' ? (
                      <ComboboxItem key={option.value} value={option}>
                        <Plus />
                        <span className="truncate">{option.label}</span>
                      </ComboboxItem>
                    ) : (
                      <ComboboxItem
                        key={option.value}
                        value={option}
                        aria-label={partialTagIds.has(option.value) ? p.onSomeCopies(option.label) : option.label}
                      >
                        <TagTreeRow depth={option.depth} color={option.color} name={option.name} />
                        {partialTagIds.has(option.value) && (
                          <Minus aria-hidden className="pointer-events-none absolute right-2 text-muted-foreground" />
                        )}
                      </ComboboxItem>
                    )
                  }
                </ComboboxCollection>
              </ComboboxList>
            </ComboboxContent>
          </Combobox>
        </Field>
        <DialogProblem title={t.board.manageTags.problemTitle} hint={t.board.manageTags.problemHint} error={error} />
        <div className="flex justify-end">
          <Button type="button" disabled={pending} onClick={onCancel}>
            {pending && <Spinner />}
            {pending ? p.updating : t.common.done}
          </Button>
        </div>
      </div>
    </DialogShell>
  )
}
