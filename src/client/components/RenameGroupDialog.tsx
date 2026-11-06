import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Field, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Spinner } from '@/components/ui/spinner'
import { MAX_PRINT_GROUP_NAME_LENGTH } from '../../core/printGroups'
import { DialogProblem } from './DialogProblem'
import { DialogShell } from './DialogShell'
import { useI18n } from '../i18n'

export function RenameGroupDialog({
  pending,
  error,
  title,
  initialName = '',
  submitLabel,
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
  const { t } = useI18n()
  const r = t.board.renameTag
  const [name, setName] = useState(initialName)
  return (
    <DialogShell title={title ?? r.title} onClose={onCancel} preventClose={pending}>
      <form
        onSubmit={(event) => {
          event.preventDefault()
          if (name.trim()) onConfirm(name.trim())
        }}
      >
        <Field>
          <FieldLabel htmlFor="print-group-name">{r.name}</FieldLabel>
          <Input
            id="print-group-name"
            maxLength={MAX_PRINT_GROUP_NAME_LENGTH}
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder={t.board.manageTags.namePlaceholder}
          />
        </Field>
        <DialogProblem title={r.problemTitle} hint={r.problemHint} error={error} />
        <div className="mt-4 flex justify-end gap-2">
          <Button type="button" variant="outline" disabled={pending} onClick={onCancel}>
            {t.common.cancel}
          </Button>
          <Button type="submit" disabled={pending || !name.trim()}>
            {pending && <Spinner />}
            {pending ? t.common.saving : (submitLabel ?? r.title)}
          </Button>
        </div>
      </form>
    </DialogShell>
  )
}
