import { useCallback } from 'react'
import { useBlocker } from '@tanstack/react-router'
import { TriangleAlert } from 'lucide-react'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
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
    <>
      {dirty && (
        <Alert className="border-amber-500/40 bg-amber-500/5">
          <TriangleAlert />
          <AlertTitle>Unsaved changes</AlertTitle>
          <AlertDescription>Save your changes before leaving this page, or they will be lost.</AlertDescription>
        </Alert>
      )}
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
    </>
  )
}
