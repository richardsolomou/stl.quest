import { Suspense, lazy, useEffect, useRef, useState } from 'react'
import { useQueryClient, useSuspenseQuery } from '@tanstack/react-query'
import { usePostHog } from '@posthog/react'
import { peopleQuery } from '../queries'
import { renderRowThumbnail } from '../rowThumb'
import { isIOS, isPhone } from '../device'
import { useEscape } from '../useEscape'
import { retryOffset } from '../uploadProtocol'

const StlViewer = lazy(() => import('./StlViewer'))

const MAX_FILE_BYTES = 1024 * 1024 * 1024
// Each chunk stays well under Cloudflare's 100 MB request-body cap.
const CHUNK_BYTES = 32 * 1024 * 1024

type Entry = {
  key: string
  uploadId: string
  file: File
  name: string
  quantity: string
  notes: string
  sourceUrl: string
  noteOpen: boolean
  linkOpen: boolean
  thumbnail?: string
  state: 'pending' | 'uploading' | 'done' | 'error'
}

let nextKey = 0

export function UploadForm({
  myName,
  chooseFor,
  initialFiles,
  onClose,
}: {
  myName: string
  chooseFor: boolean
  initialFiles?: File[]
  onClose: () => void
}) {
  const posthog = usePostHog()
  const queryClient = useQueryClient()
  const { data: people } = useSuspenseQuery(peopleQuery())
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [entries, setEntries] = useState<Entry[]>([])
  const [forName, setForName] = useState(myName)
  const [dragOver, setDragOver] = useState(false)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState<number | null>(null)

  const initialAdded = useRef(false)
  useEffect(() => {
    if (initialAdded.current || !initialFiles?.length) return
    initialAdded.current = true
    addFiles(initialFiles)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const dirty = entries.length > 0 || forName !== myName
  const requestClose = () => {
    if (busy) return
    if (!dirty || confirm('Discard this upload?')) onClose()
  }
  useEscape(requestClose)

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
        uploadId: crypto.randomUUID(),
        file,
        name: file.name.replace(/\.stl$/i, '').replace(/[_-]+/g, ' ').trim(),
        quantity: '1',
        notes: '',
        sourceUrl: '',
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

  const postChunk = (form: FormData, onProgress: (loaded: number) => void) =>
    new Promise<{ acceptedOffset?: number; completed?: boolean }>((resolve, reject) => {
      const xhr = new XMLHttpRequest()
      xhr.open('POST', '/api/upload')
      xhr.upload.onprogress = (event) => {
        if (event.lengthComputable) onProgress(event.loaded)
      }
      xhr.onload = () => {
        if (xhr.status < 300) {
          try { return resolve(JSON.parse(xhr.responseText)) } catch { return resolve({}) }
        }
        let message = `upload failed (${xhr.status})`
        try {
          message = JSON.parse(xhr.responseText).error ?? message
        } catch {}
        reject(new Error(message))
      }
      xhr.onerror = () => reject(new Error('Network error during upload.'))
      xhr.send(form)
    })

  const uploadOne = async (entry: Entry, base: number, share: number) => {
    const { file } = entry
    const uploadId = entry.uploadId
    const status = new FormData()
    status.set('uploadId', uploadId)
    status.set('offset', '0')
    status.set('status', '1')
    const uploadStatus = await postChunk(status, () => undefined)
    if (uploadStatus.completed) return
    let offset = retryOffset(uploadStatus.acceptedOffset ?? 0, file.size, CHUNK_BYTES)
    while (offset < file.size) {
      const end = Math.min(offset + CHUNK_BYTES, file.size)
      const isFinal = end >= file.size
      const form = new FormData()
      form.set('uploadId', uploadId)
      form.set('offset', String(offset))
      form.set('chunk', file.slice(offset, end))
      if (isFinal) {
        form.set('final', '1')
        form.set('fileName', file.name)
        form.set('name', entry.name.trim() || file.name.replace(/\.stl$/i, ''))
        form.set('quantity', String(Math.min(50, Math.max(1, Math.round(Number(entry.quantity) || 1)))))
        form.set('requesterName', forName)
        form.set('notes', entry.notes)
        if (entry.sourceUrl.trim()) form.set('sourceUrl', entry.sourceUrl.trim())
      }
      const chunkStart = offset
      const response = await postChunk(form, (loaded) =>
        setProgress(base + (Math.min(chunkStart + loaded, file.size) / file.size) * share),
      )
      offset = response.acceptedOffset ?? end
    }
  }

  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    if (busy) return
    if (entries.length === 0) {
      setError('Pick at least one STL first.')
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
        await uploadOne(entry, index * share, share)
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
    <div className="overlay" onClick={(e) => e.target === e.currentTarget && requestClose()}>
      <form className="dialog" onSubmit={submit}>
        <h2>Add prints</h2>

        <div
          className={`dropzone${dragOver ? ' active' : ''}`}
          role="button"
          tabIndex={0}
          onClick={() => fileInputRef.current?.click()}
          onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && fileInputRef.current?.click()}
          onDragOver={(e) => {
            e.preventDefault()
            setDragOver(true)
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => {
            e.preventDefault()
            setDragOver(false)
            addFiles(e.dataTransfer.files)
          }}
        >
          {entries.length === 0
            ? 'Drop STLs here, or click to browse'
            : `${entries.length} file${entries.length > 1 ? 's' : ''} — drop more or click to add`}
        </div>
        <input
          ref={fileInputRef}
          type="file"
          accept={isIOS() ? undefined : '.stl,model/stl,application/sla'}
          multiple
          hidden
          onChange={(e) => {
            if (e.target.files) addFiles(e.target.files)
            e.target.value = ''
          }}
        />

        {entries.length === 1 && !isPhone() && (
          <Suspense
            fallback={
              <div className="viewer">
                <div className="viewer-status">loading viewer…</div>
              </div>
            }
          >
            <StlViewer file={entries[0].file} />
          </Suspense>
        )}

        {entries.length > 0 && (
          <div className="upload-rows">
            {entries.map((entry) => (
              <div key={entry.key} className={`upload-row state-${entry.state}`}>
                <div className="thumb row-thumb">
                  {entry.thumbnail ? <img src={entry.thumbnail} alt="" /> : <span className="placeholder">stl</span>}
                </div>
                <div className="row-fields">
                  <div className="row-main">
                    <input
                      aria-label="Name"
                      value={entry.name}
                      onChange={(e) => patchEntry(entry.key, { name: e.target.value })}
                      maxLength={120}
                      required
                      disabled={entry.state === 'done'}
                    />
                    <input
                      aria-label="Copies"
                      className="row-qty"
                      type="number"
                      inputMode="numeric"
                      min={1}
                      max={50}
                      value={entry.quantity}
                      onChange={(e) => patchEntry(entry.key, { quantity: e.target.value })}
                      disabled={entry.state === 'done'}
                    />
                    {entry.state === 'done' ? (
                      <span className="row-state">✓</span>
                    ) : entry.state === 'uploading' ? (
                      <span className="row-state">…</span>
                    ) : (
                      <button
                        type="button"
                        className="row-remove"
                        aria-label={`Remove ${entry.name}`}
                        onClick={() => setEntries((prev) => prev.filter((e2) => e2.key !== entry.key))}
                      >
                        ✕
                      </button>
                    )}
                  </div>
                  {entry.noteOpen && (
                    <textarea
                      aria-label="Notes"
                      rows={2}
                      value={entry.notes}
                      onChange={(e) => patchEntry(entry.key, { notes: e.target.value })}
                      placeholder="scale, supports, colour — anything the printer should know"
                      disabled={entry.state === 'done'}
                    />
                  )}
                  {entry.linkOpen && (
                    <input
                      aria-label="Source URL"
                      type="url"
                      inputMode="url"
                      value={entry.sourceUrl}
                      onChange={(e) => patchEntry(entry.key, { sourceUrl: e.target.value })}
                      placeholder="https://… where this model came from"
                      maxLength={500}
                      disabled={entry.state === 'done'}
                    />
                  )}
                  {entry.state === 'pending' && (!entry.noteOpen || !entry.linkOpen) && (
                    <div className="row-toggles">
                      {!entry.noteOpen && (
                        <button
                          type="button"
                          className="row-note-toggle"
                          onClick={() => patchEntry(entry.key, { noteOpen: true })}
                        >
                          + add note
                        </button>
                      )}
                      {!entry.linkOpen && (
                        <button
                          type="button"
                          className="row-note-toggle"
                          onClick={() => patchEntry(entry.key, { linkOpen: true })}
                        >
                          + add link
                        </button>
                      )}
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}

        {chooseFor && (
          <div className="field">
            <label htmlFor="upload-for">For</label>
            <select id="upload-for" value={forName} onChange={(e) => setForName(e.target.value)}>
              {!people.some((person) => person.name === myName) && <option value={myName}>{myName}</option>}
              {people.map((person) => (
                <option key={person.name} value={person.name}>
                  {person.name}
                </option>
              ))}
            </select>
          </div>
        )}

        {error && <p className="error">{error}</p>}
        {progress !== null && (
          <div className="progress" role="progressbar" aria-valuenow={Math.round(progress * 100)}>
            <div className="fill" style={{ width: `${Math.round(progress * 100)}%` }} />
          </div>
        )}

        <div className="dialog-actions">
          <button type="button" className="btn" onClick={requestClose}>
            Cancel
          </button>
          <button type="submit" className="btn btn-primary" disabled={busy || remaining.length === 0}>
            {busy
              ? progress !== null
                ? `Uploading… ${Math.round(progress * 100)}%`
                : 'Uploading…'
              : `Add ${remaining.length || ''} print${remaining.length === 1 ? '' : 's'}`}
          </button>
        </div>
      </form>
    </div>
  )
}
