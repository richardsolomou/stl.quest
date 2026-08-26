import { useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { FileUp, Paperclip } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/ui/spinner'
import { ConfirmDialog } from './ConfirmDialog'
import { DialogProblem } from './DialogProblem'
import { uploadErrorMessage, uploadPrint } from './uploadTransport'
import type { UploadEntry } from './uploadTypes'
import { useWorkspaceSlug } from '../workspace'
import type { PublicPrintRequest } from '../../core/types'

/** Puts a model on a request — the first one, or a newer file — through the same pipeline as a new upload. */
export function AttachModelButton({ request }: { request: PublicPrintRequest }) {
  const workspaceSlug = useWorkspaceSlug()
  const queryClient = useQueryClient()
  const input = useRef<HTMLInputElement>(null)
  const [progress, setProgress] = useState<number>()
  const [error, setError] = useState('')
  const [confirming, setConfirming] = useState<File>()
  const busy = progress !== undefined
  const replacing = request.hasFile

  const attach = async (file: File) => {
    setError('')
    setProgress(0)
    const entry: UploadEntry = {
      key: request.id,
      file,
      name: request.name,
      quantity: String(request.quantity),
      notes: request.notes ?? '',
      sourceUrl: request.sourceUrl ?? '',
      printType: request.printType ?? '',
      noteOpen: false,
      linkOpen: false,
      state: 'pending',
      attachToRequestId: request.id,
    }
    try {
      await uploadPrint(workspaceSlug, entry, (sent, total) => setProgress(total ? Math.round((sent / total) * 100) : 0))
      // The dialog stays open and re-renders with the model in place once the board data refreshes.
      await queryClient.invalidateQueries({ queryKey: ['requests'] })
    } catch (failure) {
      setError(uploadErrorMessage(failure))
    } finally {
      setProgress(undefined)
    }
  }

  return (
    <>
      <input
        ref={input}
        type="file"
        accept=".stl,.3mf"
        className="sr-only"
        onChange={(event) => {
          const file = event.target.files?.[0]
          event.target.value = ''
          if (!file) return
          if (replacing) setConfirming(file)
          else void attach(file)
        }}
      />
      <Button type="button" variant="outline" disabled={busy} onClick={() => input.current?.click()}>
        {busy ? <Spinner /> : replacing ? <FileUp /> : <Paperclip />}
        {busy ? `Uploading… ${progress}%` : replacing ? 'Replace model' : 'Attach model'}
      </Button>
      <ConfirmDialog
        open={confirming !== undefined}
        title={`Replace the model on “${request.name}”?`}
        description={`${confirming?.name ?? 'The new file'} takes the place of the current model. The old file is deleted, and the preview and estimates are worked out again.`}
        confirmLabel="Replace model"
        destructive
        onCancel={() => setConfirming(undefined)}
        onConfirm={() => {
          const file = confirming
          setConfirming(undefined)
          if (file) void attach(file)
        }}
      />
      <DialogProblem
        title={replacing ? 'The model was not replaced' : 'The model was not attached'}
        hint={replacing ? 'The print still has its original model. Try again.' : 'The saved link is unchanged. Try again.'}
        error={error}
      />
    </>
  )
}
