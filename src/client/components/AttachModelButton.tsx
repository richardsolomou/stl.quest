import { useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Paperclip } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/ui/spinner'
import { DialogProblem } from './DialogProblem'
import { uploadErrorMessage, uploadPrint } from './uploadTransport'
import type { UploadEntry } from './uploadTypes'
import { useWorkspaceSlug } from '../workspace'
import type { PublicPrintRequest } from '../../core/types'

/** Completes a link-only request by uploading the model through the same pipeline as a new upload. */
export function AttachModelButton({ request }: { request: PublicPrintRequest }) {
  const workspaceSlug = useWorkspaceSlug()
  const queryClient = useQueryClient()
  const input = useRef<HTMLInputElement>(null)
  const [progress, setProgress] = useState<number>()
  const [error, setError] = useState('')
  const busy = progress !== undefined

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
          if (file) void attach(file)
        }}
      />
      <Button type="button" variant="outline" disabled={busy} onClick={() => input.current?.click()}>
        {busy ? <Spinner /> : <Paperclip />}
        {busy ? `Uploading… ${progress}%` : 'Attach model'}
      </Button>
      <DialogProblem title="The model was not attached" hint="The saved link is unchanged. Try again." error={error} />
    </>
  )
}
