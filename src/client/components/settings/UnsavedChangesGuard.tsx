import { useCallback } from 'react'
import { useBlocker } from '@tanstack/react-router'
import { ConfirmDialog } from '../ConfirmDialog'

export function UnsavedChangesGuard({ dirty }: { dirty: boolean }) {
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
      title="Leave without saving?"
      description="Your unsaved settings changes will be lost."
      confirmLabel="Leave without saving"
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
