import { useEffect, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { usePostHog } from '@posthog/react'
import { useDropzone } from 'react-dropzone'
import { Button } from '@/components/ui/button'
import { FieldError } from '@/components/ui/field'
import { Empty, EmptyDescription } from '@/components/ui/empty'
import { Input } from '@/components/ui/input'
import { Progress } from '@/components/ui/progress'
import { DialogProblem } from './DialogProblem'
import { Spinner } from '@/components/ui/spinner'
import { renderRowThumbnail } from '../rowThumb'
import { isIOS, isPhone } from '../device'
import { availablePrintTypes } from '../fleet'
import type { PrinterSummary } from '../../core/types'
import { MAX_UPLOAD_BYTES } from '../../core/uploadLimits'
import { DialogShell } from './DialogShell'
import { ConfirmDialog } from './ConfirmDialog'
import { LazyStlViewer } from './LazyStlViewer'
import { UploadRow } from './UploadRow'
import { isStorageQuotaError, isUploadCancelled, uploadErrorMessage, uploadPrint } from './uploadTransport'
import { StorageUpgradeAction } from './StorageUpgradeAction'
import type { UploadEntry as Entry } from './uploadTypes'
import { useWorkspaceSlug } from '../workspace'
import { prepareUploadFiles, uploadOutcome, uploadValidationError } from '../uploadEntries'
import { signalProductTourProgress } from '../productTour'
import { inspectThreeMf, splitThreeMf, type ThreeMfInspection } from '../threeMfFiles'

export function UploadForm({
  initialFiles,
  printers,
  onClose,
}: {
  initialFiles?: File[]
  printers: PrinterSummary[]
  onClose: () => void
}) {
  const workspaceSlug = useWorkspaceSlug()
  const posthog = usePostHog()
  const queryClient = useQueryClient()
  const [entries, setEntries] = useState<Entry[]>([])
  const [failure, setFailure] = useState<{ count: number; total: number; reason: string; quota: boolean }>()
  const [validation, setValidation] = useState('')
  // Files the browser turned away are a different thing from an upload that failed, so they are reported separately.
  const [skipped, setSkipped] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState<number | null>(null)
  const [confirmClose, setConfirmClose] = useState(false)
  const [splitCandidates, setSplitCandidates] = useState<ThreeMfInspection[]>([])
  const [splitting, setSplitting] = useState(false)
  const [splitProgress, setSplitProgress] = useState<{ completed: number; total: number }>()
  const [splitFailure, setSplitFailure] = useState<string>()
  const printTypes = availablePrintTypes(printers)

  const initialAdded = useRef(false)
  const activeUpload = useRef<AbortController | undefined>(undefined)
  useEffect(() => {
    if (initialAdded.current || !initialFiles?.length) return
    initialAdded.current = true
    addFiles(initialFiles)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const dirty = entries.length > 0
  // Closing without a submission is abandonment; capture it so it stops looking identical to a dialog still open.
  const dismiss = () => {
    posthog.capture('upload_dismissed', { file_count: entries.length })
    onClose()
  }
  const requestClose = () => {
    if (busy) {
      activeUpload.current?.abort()
      return
    }
    if (dirty) setConfirmClose(true)
    else dismiss()
  }

  const addPreparedFiles = (files: Iterable<File>) => {
    setValidation('')
    const { accepted, rejected } = prepareUploadFiles(files, printTypes)
    if (accepted.length) setEntries((prev) => [...prev, ...accepted])
    if (rejected.length) setSkipped(rejected)
    for (const entry of accepted) {
      void renderRowThumbnail(entry.file).then((thumbnail) => {
        if (thumbnail) patchEntry(entry.key, { thumbnail })
      })
    }
  }

  const addFiles = (files: Iterable<File>) => {
    setSkipped([])
    for (const file of files) {
      void inspectThreeMf(file)
        .then((inspection) => {
          if (inspection) setSplitCandidates((current) => [...current, inspection])
          else addPreparedFiles([file])
        })
        .catch((error) => setSkipped((current) => [...current, `${file.name} (${error instanceof Error ? error.message : 'invalid 3MF'})`]))
    }
  }

  const resolveSplitCandidate = (files: File[]) => {
    addPreparedFiles(files)
    setSplitFailure(undefined)
    setSplitCandidates((current) => current.slice(1))
  }

  const patchEntry = (key: string, patch: Partial<Entry>) =>
    setEntries((prev) => prev.map((entry) => (entry.key === key ? { ...entry, ...patch } : entry)))

  const dropzone = useDropzone({
    multiple: true,
    maxSize: MAX_UPLOAD_BYTES,
    noClick: false,
    accept: isIOS()
      ? undefined
      : {
          'model/stl': ['.stl'],
          'application/sla': ['.stl'],
          'application/vnd.ms-package.3dmanufacturing-3dmodel+xml': ['.3mf'],
        },
    onDrop: (accepted, rejected) => {
      addFiles(accepted)
      if (rejected.length) setSkipped(rejected.map(({ file }) => file.name))
    },
  })

  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    if (busy) return
    const invalid = uploadValidationError(entries)
    if (invalid) {
      setValidation(invalid)
      return
    }
    setBusy(true)
    setFailure(undefined)
    setValidation('')
    setSkipped([])
    const uploadController = new AbortController()
    activeUpload.current = uploadController
    const pending = entries.filter((entry) => entry.state !== 'done')
    const share = 1 / pending.length
    let failures = 0
    let reason = ''
    let quota = false
    for (const [index, entry] of pending.entries()) {
      patchEntry(entry.key, { state: 'uploading' })
      try {
        await uploadPrint(
          workspaceSlug,
          entry,
          (sent, total) => setProgress(index * share + (sent / total) * share),
          uploadController.signal,
        )
        await queryClient.invalidateQueries({ queryKey: ['requests'] })
        patchEntry(entry.key, { state: 'done' })
      } catch (err) {
        if (isUploadCancelled(err)) {
          activeUpload.current = undefined
          dismiss()
          return
        }
        failures++
        posthog.captureException(err, {
          action: 'upload_stl',
          file_size_bytes: entry.file.size,
        })
        patchEntry(entry.key, { state: 'error' })
        reason ||= uploadErrorMessage(err)
        quota ||= isStorageQuotaError(err)
      }
    }
    activeUpload.current = undefined
    const submittedPrintTypes = [...new Set(pending.map((entry) => entry.printType))]
    posthog.capture('request_submission_completed', {
      ...uploadOutcome(pending.length, failures),
      print_types: submittedPrintTypes,
    })
    if (failures === 0) {
      posthog.capture('requests_submitted', {
        file_count: pending.length,
        print_types: submittedPrintTypes,
      })
      signalProductTourProgress('upload')
      onClose()
    } else {
      setBusy(false)
      setProgress(null)
      setFailure({ count: failures, total: pending.length, reason, quota })
    }
  }

  const remaining = entries.filter((entry) => entry.state !== 'done')

  return (
    <>
      <DialogShell onClose={requestClose} title="Add prints" preventClose={busy}>
        <form onSubmit={submit}>
          <Empty
            {...dropzone.getRootProps({
              className: `mb-3 cursor-pointer border bg-background transition-colors [background-image:var(--grid)] [background-size:24px_24px] hover:border-primary ${dropzone.isDragActive ? 'border-primary' : ''}`,
            })}
          >
            <Input {...dropzone.getInputProps()} className="sr-only" />
            <EmptyDescription>
              {entries.length === 0
                ? 'Drop STL or 3MF files here, or click to browse'
                : `${entries.length} file${entries.length > 1 ? 's' : ''} — drop more or click to add`}
            </EmptyDescription>
          </Empty>

          {entries.length === 1 && !isPhone() && <LazyStlViewer file={entries[0].file} />}

          {entries.length > 0 && (
            <div className="mb-3 flex max-h-[40dvh] flex-col gap-2 overflow-y-auto">
              {entries.map((entry) => (
                <UploadRow
                  key={entry.key}
                  entry={entry}
                  printTypes={printTypes}
                  onPatch={(patch) => patchEntry(entry.key, patch)}
                  onRemove={() => setEntries((previous) => previous.filter((candidate) => candidate.key !== entry.key))}
                />
              ))}
            </div>
          )}

          <FieldError>{validation}</FieldError>
          {skipped.length > 0 && (
            <p className="text-sm text-muted-foreground">
              Skipped {skipped.join(', ')} — STL Quest accepts .stl and .3mf files up to the configured size limit.
            </p>
          )}
          <DialogProblem
            title={
              failure
                ? `${failure.count} of ${failure.total} print${failure.total > 1 ? 's' : ''} could not be added`
                : 'Some prints could not be added'
            }
            hint={
              failure?.quota
                ? 'Free up space by deleting prints you no longer need, or raise the allowance.'
                : 'The rows that failed are marked below; everything else was added. Press Add to retry just those.'
            }
            error={failure?.reason}
          />
          {failure?.quota && <StorageUpgradeAction className="mb-3 self-start" onNavigate={onClose} />}
          {progress !== null && <Progress value={progress * 100} aria-label="Upload progress" />}

          <div className="mt-2 flex flex-col-reverse gap-2.5 sm:flex-row sm:justify-end [&>*]:w-full sm:[&>*]:w-auto">
            <Button type="button" variant="outline" onClick={requestClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={busy || remaining.length === 0}>
              {busy && <Spinner />}
              {busy
                ? progress !== null
                  ? `Uploading… ${Math.round(progress * 100)}%`
                  : 'Uploading…'
                : `Add ${remaining.length || ''} print${remaining.length === 1 ? '' : 's'}`}
            </Button>
          </div>
        </form>
      </DialogShell>
      <ConfirmDialog
        open={splitCandidates.length > 0}
        title={`${splitCandidates[0]?.itemCount ?? 0} separate build items found`}
        description="Keep this 3MF together as one print request, or create an independent request file for each top-level build item."
        confirmLabel="Split into requests"
        pendingLabel={splitProgress ? `Splitting ${splitProgress.completed} of ${splitProgress.total}…` : 'Preparing split…'}
        cancelLabel="Keep together"
        pending={splitting}
        problem={
          splitFailure
            ? { title: 'This 3MF could not be split', hint: 'Keep it together, or try splitting it again.', error: splitFailure }
            : undefined
        }
        onCancel={() => {
          const candidate = splitCandidates[0]
          if (candidate) resolveSplitCandidate([candidate.file])
        }}
        onConfirm={() => {
          const candidate = splitCandidates[0]
          if (!candidate) return
          setSplitting(true)
          setSplitProgress({ completed: 0, total: candidate.itemCount })
          setSplitFailure(undefined)
          void splitThreeMf(candidate.file, (completed, total) => setSplitProgress({ completed, total }))
            .then(resolveSplitCandidate)
            .catch((error) => setSplitFailure(error instanceof Error ? error.message : 'The file could not be split.'))
            .finally(() => {
              setSplitting(false)
              setSplitProgress(undefined)
            })
        }}
      />
      <ConfirmDialog
        open={confirmClose}
        title="Discard upload?"
        description="Selected files and metadata will be lost."
        confirmLabel="Discard"
        destructive
        onCancel={() => setConfirmClose(false)}
        onConfirm={dismiss}
      />
    </>
  )
}
