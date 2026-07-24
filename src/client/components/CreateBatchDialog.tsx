import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Field, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { DialogShell } from './DialogShell'

export function CreateBatchDialog({
  pending,
  error,
  onConfirm,
  onCancel,
}: {
  pending: boolean
  error?: string
  onConfirm: (name: string) => void
  onCancel: () => void
}) {
  const [name, setName] = useState('')
  return (
    <DialogShell title="Create print batch" onClose={onCancel} preventClose={pending}>
      <form
        onSubmit={(event) => {
          event.preventDefault()
          if (name.trim()) onConfirm(name.trim())
        }}
      >
        <Field>
          <FieldLabel htmlFor="print-batch-name">Batch name</FieldLabel>
          <Input
            id="print-batch-name"
            maxLength={80}
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="e.g. Dragon plate"
          />
        </Field>
        {error && (
          <p role="alert" className="mt-3 text-sm text-destructive">
            {error}
          </p>
        )}
        <div className="mt-4 flex justify-end gap-2">
          <Button type="button" variant="outline" disabled={pending} onClick={onCancel}>
            Cancel
          </Button>
          <Button type="submit" disabled={pending || !name.trim()}>
            {pending ? 'Creating…' : 'Create batch'}
          </Button>
        </div>
      </form>
    </DialogShell>
  )
}
