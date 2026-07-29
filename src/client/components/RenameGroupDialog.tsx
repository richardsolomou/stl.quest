import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Field, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { MAX_PRINT_GROUP_NAME_LENGTH } from '../../core/printGroups'
import { DialogProblem } from './DialogProblem'
import { DialogShell } from './DialogShell'

export function RenameGroupDialog({
  pending,
  error,
  title = 'Rename print group',
  initialName = '',
  submitLabel = 'Rename group',
  onConfirm,
  onCancel,
}: {
  pending: boolean
  error?: string
  title?: string
  initialName?: string
  submitLabel?: string
  onConfirm: (name: string) => void
  onCancel: () => void
}) {
  const [name, setName] = useState(initialName)
  return (
    <DialogShell title={title} onClose={onCancel} preventClose={pending}>
      <form
        onSubmit={(event) => {
          event.preventDefault()
          if (name.trim()) onConfirm(name.trim())
        }}
      >
        <Field>
          <FieldLabel htmlFor="print-group-name">Group name</FieldLabel>
          <Input
            id="print-group-name"
            maxLength={MAX_PRINT_GROUP_NAME_LENGTH}
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="e.g. Dragon plate"
          />
        </Field>
        <DialogProblem title="The group was not renamed" hint="It still has its previous name. Try again." error={error} />
        <div className="mt-4 flex justify-end gap-2">
          <Button type="button" variant="outline" disabled={pending} onClick={onCancel}>
            Cancel
          </Button>
          <Button type="submit" disabled={pending || !name.trim()}>
            {pending ? 'Saving…' : submitLabel}
          </Button>
        </div>
      </form>
    </DialogShell>
  )
}
