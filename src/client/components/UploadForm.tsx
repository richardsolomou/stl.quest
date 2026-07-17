import { useEffect, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { usePostHog } from '@posthog/react'
import { useDropzone } from 'react-dropzone'
import { Button } from '@/components/ui/button'
import { FieldError } from '@/components/ui/field'
import { Empty, EmptyDescription } from '@/components/ui/empty'
import { Input } from '@/components/ui/input'
import { Progress } from '@/components/ui/progress'
import { Spinner } from '@/components/ui/spinner'
import { renderRowThumbnail } from '../rowThumb'
import { isIOS, isPhone } from '../device'
import { availablePrintTypes } from '../fleet'
import type { PrinterSummary } from '../../core/types'
import { DialogShell } from './DialogShell'
import { ConfirmDialog } from './ConfirmDialog'
import { LazyStlViewer } from './LazyStlViewer'
import { UploadRow } from './UploadRow'
import { uploadPrint } from './uploadTransport'
import type { UploadEntry as Entry } from './uploadTypes'
import { useWorkspaceSlug } from '../workspace'

const MAX_FILE_BYTES = 1024 * 1024 * 1024
let nextKey = 0
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
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState<number | null>(null)
  const [confirmClose, setConfirmClose] = useState(false)
  const printTypes = availablePrintTypes(printers)

  const initialAdded = useRef(false)
  useEffect(() => {
    if (initialAdded.current || !initialFiles?.length) return
    initialAdded.current = true
    addFiles(initialFiles)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const dirty = entries.length > 0
  const requestClose = () => {
    if (busy) return
    if (dirty) setConfirmClose(true)
    else onClose()
  }

  const addFiles = (files: Iterable<File>) => {
    setError('')
    const rejected: string[] = []
    const accepted: Entry[] = []
    for (const file of files) {
      if (!/\.stl$/i.test(file.name)) {
        rejected.push(`${file.name} (not an STL)`)
        continue
      }
      if (file.size === 0 || file.size > MAX_FILE_BYTES) {
        rejected.push(`${file.name} (over the 1 GB limit)`)
        continue
      }
      const entry: Entry = {
        key: `f${nextKey++}`,
        file,
        name: file.name
          .replace(/\.stl$/i, '')
          .replace(/[_-]+/g, ' ')
          .trim(),
        quantity: '1',
        notes: '',
        sourceUrl: '',
        printType: printTypes[0],
        noteOpen: false,
        linkOpen: false,
        state: 'pending',
      }
      accepted.push(entry)
    }
    if (accepted.length) setEntries((prev) => [...prev, ...accepted])
    if (rejected.length) setError(`Skipped: ${rejected.join(', ')}`)
    for (const entry of accepted) {
      void renderRowThumbnail(entry.file).then((thumbnail) => {
        if (thumbnail) patchEntry(entry.key, { thumbnail })
      })
    }
  }

  const patchEntry = (key: string, patch: Partial<Entry>) =>
    setEntries((prev) => prev.map((entry) => (entry.key === key ? { ...entry, ...patch } : entry)))

  const dropzone = useDropzone({
    multiple: true,
    maxSize: MAX_FILE_BYTES,
    noClick: false,
    accept: isIOS() ? undefined : { 'model/stl': ['.stl'], 'application/sla': ['.stl'] },
    onDrop: (accepted, rejected) => {
      addFiles(accepted)
      if (rejected.length) setError(`Skipped: ${rejected.map(({ file }) => file.name).join(', ')}`)
    },
  })

  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    if (busy) return
    if (entries.length === 0) {
      setError('Pick at least one STL first.')
      return
    }
    if (entries.some((entry) => !entry.printType)) {
      setError('Choose resin or filament for every model.')
      return
    }
    setBusy(true)
    setError('')
    const pending = entries.filter((entry) => entry.state !== 'done')
    const share = 1 / pending.length
    let failures = 0
    for (const [index, entry] of pending.entries()) {
      patchEntry(entry.key, { state: 'uploading' })
      try {
        await uploadPrint(workspaceSlug, entry, (sent, total) => setProgress(index * share + (sent / total) * share))
        await queryClient.invalidateQueries({ queryKey: ['requests'] })
        patchEntry(entry.key, { state: 'done' })
      } catch (err) {
        failures++
        posthog.captureException(err, {
          action: 'upload_stl',
          file_size_bytes: entry.file.size,
        })
        patchEntry(entry.key, { state: 'error' })
        setError(err instanceof Error ? err.message : 'Upload failed.')
      }
    }
    if (failures === 0) {
      posthog.capture('requests_submitted', {
        file_count: pending.length,
        print_types: [...new Set(pending.map((entry) => entry.printType))],
      })
      onClose()
    } else {
      setBusy(false)
      setProgress(null)
      setError((prev) => `${failures} upload${failures > 1 ? 's' : ''} failed — press Add to retry. ${prev}`)
    }
  }

  const remaining = entries.filter((entry) => entry.state !== 'done')

  return (
    <>
      <DialogShell onClose={requestClose} title="Add prints" preventClose={busy}>
        <form onSubmit={submit}>
          <Empty
            {...dropzone.getRootProps({
              className: `mb-3 cursor-pointer border bg-background transition-colors hover:border-primary ${dropzone.isDragActive ? 'border-primary' : ''}`,
            })}
          >
            <Input {...dropzone.getInputProps()} className="sr-only" />
            <EmptyDescription>
              {entries.length === 0
                ? 'Drop STLs here, or click to browse'
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

          <FieldError>{error}</FieldError>
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
        open={confirmClose}
        title="Discard upload?"
        description="Selected files and metadata will be lost."
        confirmLabel="Discard"
        destructive
        onCancel={() => setConfirmClose(false)}
        onConfirm={onClose}
      />
    </>
  )
}
