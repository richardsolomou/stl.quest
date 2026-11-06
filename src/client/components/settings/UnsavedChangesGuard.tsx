import { useCallback } from 'react'
import { useBlocker } from '@tanstack/react-router'
import { ConfirmDialog } from '../ConfirmDialog'
import { useI18n } from '../../i18n'

export function UnsavedChangesGuard({ dirty }: { dirty: boolean }) {
  const copy = useI18n().t.settings.unsavedChanges
  const shouldBlock = useCallback(() => dirty, [dirty])
  const blocker = useBlocker({
    shouldBlockFn: shouldBlock,
    enableBeforeUnload: dirty,
    disabled: !dirty,
    withResolver: true,
  })

  return (
    <ConfirmDialog
      open={blocker.status === 'blocked'}
      title={copy.title}
      description={copy.description}
      confirmLabel={copy.confirm}
      destructive
      onCancel={() => {
        if (blocker.status === 'blocked') blocker.reset()
      }}
      onConfirm={() => {
        if (blocker.status === 'blocked') blocker.proceed()
      }}
    />
  )
}
