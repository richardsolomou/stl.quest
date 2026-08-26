import { useEffect, useRef, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useServerFn } from '@tanstack/react-start'
import { usePostHog } from '@posthog/react'
import { useDropzone } from 'react-dropzone'
import { Link2, Upload } from 'lucide-react'
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
import { splitThreeMf, type SplitThreeMfPart, type ThreeMfInspection } from '../threeMfFiles'
import { cancelThreeMfInspections, inspectThreeMf } from '../threeMfInspection'
import { createLinkedRequest } from '../../server/fns'
import { errorMessage, isReportableMutationError } from '../../core/error'
import {
  linkedRequestData,
  linkedRequestDirty,
  linkedRequestValidationError,
  linkedRequestValues,
  type LinkedRequestValues,
} from '../linkedRequest'
import { LinkedRequestForm } from './LinkedRequestForm'

export function UploadForm({
  initialFiles,
  initialMode = 'link',
  printers,
  uploadsEnabled,
  onClose,
}: {
  initialFiles?: File[]
  initialMode?: 'upload' | 'link'
  printers: PrinterSummary[]
  uploadsEnabled: boolean
  onClose: () => void
}) {
  const workspaceSlug = useWorkspaceSlug()
  const posthog = usePostHog()
  const queryClient = useQueryClient()
  const callCreateLinkedRequest = useServerFn(createLinkedRequest)
  const printTypes = availablePrintTypes(printers)
  const [mode, setMode] = useState<'upload' | 'link'>(initialFiles?.length ? 'upload' : uploadsEnabled ? initialMode : 'link')
  const [linkedValues, setLinkedValues] = useState<LinkedRequestValues>(() => linkedRequestValues(printTypes[0]))
  const [linkedValidation, setLinkedValidation] = useState('')
  const [entries, setEntries] = useState<Entry[]>([])
  const [failure, setFailure] = useState<{ count: number; total: number; reason: string; quota: boolean }>()
  const [validation, setValidation] = useState('')
  // Files the browser turned away are a different thing from an upload that failed, so they are reported separately.
  const [skipped, setSkipped] = useState<string[]>([])
  const [uploading, setUploading] = useState(false)
  const [progress, setProgress] = useState<number | null>(null)
  const [confirmClose, setConfirmClose] = useState(false)
  const [splitCandidates, setSplitCandidates] = useState<ThreeMfInspection[]>([])
  const [splitting, setSplitting] = useState(false)
  const [splitProgress, setSplitProgress] = useState<{ completed: number; total: number }>()
  const [splitFailure, setSplitFailure] = useState<string>()
  const [inspectingFiles, setInspectingFiles] = useState(0)
  const linkedMutation = useMutation({
    mutationFn: callCreateLinkedRequest,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['requests', workspaceSlug] })
      signalProductTourProgress('upload')
      onClose()
    },
    onError: (error) => {
      if (isReportableMutationError(error)) {
        posthog.captureException(error, { action: 'create_linked_request', print_type: linkedValues.printType })
      }
    },
  })
  const busy = uploading || linkedMutation.isPending

  const initialAdded = useRef(false)
  const activeUpload = useRef<AbortController | undefined>(undefined)
  const inspectionGeneration = useRef(0)
  useEffect(() => {
    if (initialAdded.current || !initialFiles?.length) return
    initialAdded.current = true
    addFiles(initialFiles)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  useEffect(
    () => () => {
      inspectionGeneration.current++
      cancelThreeMfInspections()
      activeUpload.current?.abort()
    },
    [],
  )

  const dirty = entries.length > 0 || linkedRequestDirty(linkedValues)
  // Closing without a submission is abandonment; capture it so it stops looking identical to a dialog still open.
  const dismiss = () => {
    inspectionGeneration.current++
    cancelThreeMfInspections()
    if (mode === 'upload') posthog.capture('upload_dismissed', { file_count: entries.length })
    onClose()
  }
  const requestClose = () => {
    if (busy) {
      if (uploading) activeUpload.current?.abort()
      return
    }
    if (dirty) setConfirmClose(true)
    else dismiss()
  }

  const addPreparedFiles = (files: Iterable<File>, quantities = new Map<File, number>()) => {
    setValidation('')
    const { accepted, rejected } = prepareUploadFiles(files, printTypes)
    const prepared = accepted.map((entry) => ({ ...entry, quantity: String(quantities.get(entry.file) ?? 1) }))
    if (prepared.length) setEntries((prev) => [...prev, ...prepared])
    if (rejected.length) setSkipped(rejected)
    for (const entry of prepared) {
      void renderRowThumbnail(entry.file).then((thumbnail) => {
        if (thumbnail) patchEntry(entry.key, { thumbnail })
      })
    }
  }

  const addFiles = (files: Iterable<File>) => {
    setSkipped([])
    const generation = inspectionGeneration.current
    for (const file of files) {
      const inspecting = file.name.toLowerCase().endsWith('.3mf')
      if (inspecting) setInspectingFiles((count) => count + 1)
      void inspectThreeMf(file)
        .then((inspection) => {
          if (generation !== inspectionGeneration.current) return
          if (inspection) setSplitCandidates((current) => [...current, inspection])
          else addPreparedFiles([file])
        })
        .catch((error) => {
          if (generation === inspectionGeneration.current)
            setSkipped((current) => [...current, `${file.name} (${error instanceof Error ? error.message : 'invalid 3MF'})`])
        })
        .finally(() => {
          if (inspecting && generation === inspectionGeneration.current) setInspectingFiles((count) => Math.max(0, count - 1))
        })
    }
  }

  const resolveSplitCandidate = (parts: SplitThreeMfPart[]) => {
    addPreparedFiles(
      parts.map((part) => part.file),
      new Map(parts.map((part) => [part.file, part.quantity])),
    )
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
    setUploading(true)
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
      setUploading(false)
      setProgress(null)
      setFailure({ count: failures, total: pending.length, reason, quota })
    }
  }

  const submitLinked = (event: React.FormEvent) => {
    event.preventDefault()
    const validationError = linkedRequestValidationError(linkedValues)
    setLinkedValidation(validationError ?? '')
    if (validationError) return
    const data = linkedRequestData(workspaceSlug, linkedValues)
    if (data) linkedMutation.mutate({ data })
  }

  const remaining = entries.filter((entry) => entry.state !== 'done')

  return (
    <>
      <DialogShell
        onClose={requestClose}
        title="Add a print"
        description="Upload a model, or save a link to print later."
        preventClose={busy}
      >
        <div className="grid grid-cols-2 rounded-lg bg-muted p-1">
          <Button
            type="button"
            variant={mode === 'upload' ? 'default' : 'ghost'}
            disabled={!uploadsEnabled}
            title={uploadsEnabled ? undefined : 'File uploads are unavailable until storage is ready'}
            onClick={() => setMode('upload')}
          >
            <Upload /> Upload files
          </Button>
          <Button type="button" variant={mode === 'link' ? 'default' : 'ghost'} onClick={() => setMode('link')}>
            <Link2 /> Add from link
          </Button>
        </div>

        {mode === 'link' ? (
          <LinkedRequestForm
            values={linkedValues}
            printTypes={printTypes}
            pending={linkedMutation.isPending}
            validation={linkedValidation}
            failure={linkedMutation.error ? errorMessage(linkedMutation.error, 'The server did not accept this print.') : undefined}
            onChange={(patch) => {
              setLinkedValidation('')
              setLinkedValues((current) => ({ ...current, ...patch }))
            }}
            onCancel={requestClose}
            onSubmit={submitLinked}
          />
        ) : (
          <form onSubmit={submit}>
            <Empty
              {...dropzone.getRootProps({
                className: `mb-3 cursor-pointer border bg-background transition-colors [background-image:var(--grid)] [background-size:24px_24px] hover:border-primary ${dropzone.isDragActive ? 'border-primary' : ''}`,
              })}
            >
              <Input {...dropzone.getInputProps()} className="sr-only" />
              <EmptyDescription>
                {inspectingFiles > 0 ? (
                  <span className="inline-flex items-center gap-2">
                    <Spinner />
                    Inspecting {inspectingFiles} 3MF file{inspectingFiles === 1 ? '' : 's'}…
                  </span>
                ) : entries.length === 0 ? (
                  'Drop STL or 3MF files here, or click to browse'
                ) : (
                  `${entries.length} file${entries.length > 1 ? 's' : ''} — drop more or click to add`
                )}
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
              <Button type="submit" disabled={uploading || inspectingFiles > 0 || remaining.length === 0}>
                {uploading && <Spinner />}
                {uploading
                  ? progress !== null
                    ? `Uploading… ${Math.round(progress * 100)}%`
                    : 'Uploading…'
                  : `Add ${remaining.length || ''} print${remaining.length === 1 ? '' : 's'}`}
              </Button>
            </div>
          </form>
        )}
      </DialogShell>
      <ConfirmDialog
        open={splitCandidates.length > 0}
        title={`${splitCandidates[0]?.itemCount ?? 0} separate build items found`}
        description={`Keep this 3MF together as one print request, or create ${splitCandidates[0]?.requestCount ?? 0} independent requests. Repeated objects become copies of one request.`}
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
          if (candidate) resolveSplitCandidate([{ file: candidate.file, quantity: 1 }])
        }}
        onConfirm={() => {
          const candidate = splitCandidates[0]
          if (!candidate) return
          setSplitting(true)
          setSplitProgress({ completed: 0, total: candidate.requestCount })
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
        title="Discard this draft?"
        description="Entered details and selected files will be lost."
        confirmLabel="Discard"
        destructive
        onCancel={() => setConfirmClose(false)}
        onConfirm={dismiss}
      />
    </>
  )
}
