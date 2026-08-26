import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { uploadErrorMessage, uploadPrint } from './components/uploadTransport'
import type { UploadEntry } from './components/uploadTypes'
import { useWorkspaceSlug } from './workspace'
import type { PublicPrintRequest } from '../core/types'

export type ModelAttachment = ReturnType<typeof useModelAttachment>

/**
 * Puts a model on a request through the same pipeline as a new upload, whether the file arrives from the
 * button or a drop on the open dialog. Replacing an existing model destroys it, so `start` holds the file
 * until the caller's confirmation resolves.
 */
export function useModelAttachment(request: PublicPrintRequest) {
  const workspaceSlug = useWorkspaceSlug()
  const queryClient = useQueryClient()
  const [progress, setProgress] = useState<number>()
  const [error, setError] = useState('')
  const [confirming, setConfirming] = useState<File>()
  const replacing = request.hasFile

  const send = async (file: File) => {
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

  return {
    replacing,
    progress,
    busy: progress !== undefined,
    error,
    confirming,
    start: (file: File) => {
      if (replacing) setConfirming(file)
      else void send(file)
    },
    confirm: () => {
      const file = confirming
      setConfirming(undefined)
      if (file) void send(file)
    },
    cancel: () => setConfirming(undefined),
  }
}
