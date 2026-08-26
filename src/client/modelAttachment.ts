import { useState } from 'react'
import { uploadErrorMessage, uploadPrint } from './components/uploadTransport'
import type { UploadEntry } from './components/uploadTypes'
import { UNCHANGED_MODEL, stagedModelIncomplete, stagedModelState, type StagedModel } from './requestEditor'
import { useWorkspaceSlug } from './workspace'
import type { PrintType, PublicPrintRequest } from '../core/types'

export type ModelAttachment = ReturnType<typeof useModelAttachment>

/**
 * Holds the model the editor will save. Nothing reaches the server until `upload` runs from the save
 * handler, so clearing a model and picking a new one is as reversible as any other field in the form.
 */
export function useModelAttachment(request: PublicPrintRequest) {
  const workspaceSlug = useWorkspaceSlug()
  const [staged, setStaged] = useState<StagedModel>(UNCHANGED_MODEL)
  const [progress, setProgress] = useState<number>()

  return {
    staged,
    state: stagedModelState(request, staged),
    incomplete: stagedModelIncomplete(request, staged),
    progress,
    uploading: progress !== undefined,
    clear: () => setStaged({ cleared: true }),
    choose: (file: File) => setStaged({ cleared: request.hasFile, file }),
    reset: () => setStaged(UNCHANGED_MODEL),
    /** Runs the picked file through the same tus pipeline as a new upload. Resolves to an error message. */
    upload: async (printType: PrintType | '') => {
      const file = staged.file
      if (!file) return
      setProgress(0)
      const entry: UploadEntry = {
        key: request.id,
        file,
        name: request.name,
        quantity: String(request.quantity),
        notes: request.notes ?? '',
        sourceUrl: request.sourceUrl ?? '',
        printType,
        noteOpen: false,
        linkOpen: false,
        state: 'pending',
        attachToRequestId: request.id,
      }
      try {
        await uploadPrint(workspaceSlug, entry, (sent, total) => setProgress(total ? Math.round((sent / total) * 100) : 0))
        return undefined
      } catch (failure) {
        return uploadErrorMessage(failure)
      } finally {
        setProgress(undefined)
      }
    },
  }
}
