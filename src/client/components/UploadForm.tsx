import { useEffect, useRef, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useServerFn } from '@tanstack/react-start'
import { usePostHog } from '@posthog/react'
import { useDropzone } from 'react-dropzone'
import { Link2, Upload } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
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
import { isUploadCancelled, uploadErrorMessage, uploadPrint, uploadRejection } from './uploadTransport'
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
import { useI18n } from '../i18n'

export function UploadForm({
  initialFiles,
  initialMode = 'upload',
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
  const { t } = useI18n()
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
    const { accepted, rejected } = prepareUploadFiles(files, printTypes, t.requests)
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
            setSkipped((current) => [
              ...current,
              t.requests.upload.rejectedFile(file.name, error instanceof Error ? error.message : t.requests.upload.invalidThreeMf),
            ])
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
          'model/obj': ['.obj'],
        },
    onDrop: (accepted, rejected) => {
      addFiles(accepted)
      if (rejected.length) setSkipped(rejected.map(({ file }) => file.name))
    },
  })

  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    if (busy) return
    const invalid = uploadValidationError(entries, t.requests)
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
    const failureReasons = new Set<string>()
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
        const rejection = uploadRejection(err)
        failureReasons.add(rejection ?? 'unexpected')
        if (!rejection) {
          posthog.captureException(err, {
            action: 'upload_stl',
            file_size_bytes: entry.file.size,
          })
        }
        patchEntry(entry.key, { state: 'error' })
        reason ||= uploadErrorMessage(err, t.requests)
        quota ||= rejection === 'storage_quota'
      }
    }
    activeUpload.current = undefined
    const submittedPrintTypes = [...new Set(pending.map((entry) => entry.printType))]
    posthog.capture('request_submission_completed', {
      ...uploadOutcome(pending.length, failures),
      print_types: submittedPrintTypes,
      ...(failureReasons.size ? { failure_reasons: [...failureReasons].sort() } : {}),
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
    const validationError = linkedRequestValidationError(linkedValues, t.requests)
    setLinkedValidation(validationError ?? '')
    if (validationError) return
    const data = linkedRequestData(workspaceSlug, linkedValues)
    if (data) linkedMutation.mutate({ data })
  }

  const remaining = entries.filter((entry) => entry.state !== 'done')

  return (
    <>
      <DialogShell onClose={requestClose} title={t.requests.upload.title} description={t.requests.upload.description} preventClose={busy}>
        {/* Choosing a mode is not the action that commits, so the selected segment is raised, not amber. */}
        <fieldset className="m-0 grid grid-cols-2 rounded-lg bg-muted p-1">
          <legend className="sr-only">{t.requests.upload.modeLegend}</legend>
          <Button
            type="button"
            variant="ghost"
            aria-pressed={mode === 'upload'}
            className={cn(mode === 'upload' && 'bg-accent text-foreground ring-1 ring-foreground/10 hover:bg-accent')}
            disabled={!uploadsEnabled}
            title={uploadsEnabled ? undefined : t.requests.upload.uploadsUnavailable}
            onClick={() => setMode('upload')}
          >
            <Upload /> {t.requests.upload.uploadFiles}
          </Button>
          <Button
            type="button"
            variant="ghost"
            aria-pressed={mode === 'link'}
            className={cn(mode === 'link' && 'bg-accent text-foreground ring-1 ring-foreground/10 hover:bg-accent')}
            onClick={() => setMode('link')}
          >
            <Link2 /> {t.requests.upload.addFromLink}
          </Button>
        </fieldset>

        {mode === 'link' ? (
          <LinkedRequestForm
            values={linkedValues}
            printTypes={printTypes}
            pending={linkedMutation.isPending}
            validation={linkedValidation}
            failure={linkedMutation.error ? errorMessage(linkedMutation.error, t.requests.linked.rejected) : undefined}
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
                    {t.requests.upload.inspecting(inspectingFiles)}
                  </span>
                ) : entries.length === 0 ? (
                  t.requests.upload.dropPrompt
                ) : (
                  t.requests.upload.filesAdded(entries.length)
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
            {skipped.length > 0 && <p className="text-sm text-muted-foreground">{t.requests.upload.skipped(skipped.join(', '))}</p>}
            <DialogProblem
              title={failure ? t.requests.upload.failedTitle(failure.count, failure.total) : t.requests.upload.failedTitleFallback}
              hint={failure?.quota ? t.requests.upload.quotaHint : t.requests.upload.retryHint}
              error={failure?.reason}
            />
            {failure?.quota && <StorageUpgradeAction className="mb-3 self-start" onNavigate={onClose} />}
            {progress !== null && <Progress value={progress * 100} aria-label={t.requests.upload.progressLabel} />}

            <div className="mt-2 flex flex-col-reverse gap-2.5 sm:flex-row sm:justify-end [&>*]:w-full sm:[&>*]:w-auto">
              <Button type="button" variant="outline" onClick={requestClose}>
                {t.common.cancel}
              </Button>
              <Button type="submit" disabled={uploading || inspectingFiles > 0 || remaining.length === 0}>
                {uploading && <Spinner />}
                {uploading
                  ? progress !== null
                    ? t.requests.upload.uploadingPercent(Math.round(progress * 100))
                    : t.requests.upload.uploading
                  : t.requests.upload.addPrints(remaining.length)}
              </Button>
            </div>
          </form>
        )}
      </DialogShell>
      <ConfirmDialog
        open={splitCandidates.length > 0}
        title={t.requests.split.title(splitCandidates[0]?.itemCount ?? 0)}
        description={t.requests.split.description(splitCandidates[0]?.requestCount ?? 0)}
        confirmLabel={t.requests.split.confirm}
        pendingLabel={splitProgress ? t.requests.split.progress(splitProgress.completed, splitProgress.total) : t.requests.split.preparing}
        cancelLabel={t.requests.split.keepTogether}
        pending={splitting}
        problem={splitFailure ? { title: t.requests.split.failedTitle, hint: t.requests.split.failedHint, error: splitFailure } : undefined}
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
            .catch((error) => setSplitFailure(error instanceof Error ? error.message : t.requests.split.failedFallback))
            .finally(() => {
              setSplitting(false)
              setSplitProgress(undefined)
            })
        }}
      />
      <ConfirmDialog
        open={confirmClose}
        title={t.requests.upload.discardTitle}
        description={t.requests.upload.discardDescription}
        confirmLabel={t.requests.modal.discard}
        destructive
        onCancel={() => setConfirmClose(false)}
        onConfirm={dismiss}
      />
    </>
  )
}
