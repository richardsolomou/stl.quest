import type { ReactNode } from 'react'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { DialogProblem } from './DialogProblem'

export function ConfirmDialog({
  open,
  title,
  description,
  details,
  size = 'default',
  confirmLabel,
  cancelLabel = 'Cancel',
  destructive = false,
  pending = false,
  problem,
  onConfirm,
  onCancel,
}: {
  open: boolean
  title: string
  description: string
  details?: ReactNode
  size?: 'default' | 'sm' | 'lg'
  confirmLabel: string
  cancelLabel?: string
  destructive?: boolean
  pending?: boolean
  // A failed confirmation keeps the dialog open and says so here, rather than closing and leaving a toast to explain.
  problem?: { title: string; hint: string; error?: string }
  onConfirm: () => void
  onCancel: () => void
}) {
  return (
    <AlertDialog
      open={open}
      onOpenChange={(next) => {
        if (!next && !pending) onCancel()
      }}
    >
      <AlertDialogContent size={size} className="max-h-[calc(100dvh-2rem)] overflow-y-auto">
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </AlertDialogHeader>
        {details}
        {problem && <DialogProblem title={problem.title} hint={problem.hint} error={problem.error ?? 'No further detail was returned.'} />}
        <AlertDialogFooter>
          <AlertDialogCancel disabled={pending}>{cancelLabel}</AlertDialogCancel>
          <AlertDialogAction disabled={pending} variant={destructive ? 'destructive' : 'default'} onClick={onConfirm}>
            {confirmLabel}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
