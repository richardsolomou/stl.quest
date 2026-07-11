import { Suspense, lazy, useEffect, useRef, useState } from 'react'
import { useSuspenseQuery } from '@tanstack/react-query'
import { convexQuery } from '@convex-dev/react-query'
import { usePostHog } from '@posthog/react'
import { api } from '../../convex/_generated/api'
import { prepareUploadAssets } from '../lib/uploadAssets'
import { isIOS, isPhone } from '../lib/device'
import { useEscape } from '../lib/useEscape'

const StlViewer = lazy(() => import('./StlViewer'))

const MAX_FILE_BYTES = 1024 * 1024 * 1024
// Each chunk stays well under Cloudflare's 100 MB request-body cap.
const CHUNK_BYTES = 32 * 1024 * 1024

type Entry = {
  key: string
  file: File
  name: string
  quantity: string
  notes: string
  noteOpen: boolean
  thumbnail?: string
  preview?: File
  state: 'pending' | 'uploading' | 'done' | 'error'
}

let nextKey = 0

export function UploadForm({
  myName,
  initialFiles,
  onClose,
}: {
  myName: string
  initialFiles?: File[]
  onClose: () => void
}) {
  const posthog = usePostHog()
  const { data: people } = useSuspenseQuery(convexQuery(api.users.list, {}))
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [entries, setEntries] = useState<Entry[]>([])
  const assetPromises = useRef(new Map<string, Promise<{ thumbnail?: string; preview?: File }>>())
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
        file,
        name: file.name.replace(/\.stl$/i, '').replace(/[_-]+/g, ' ').trim(),
        quantity: '1',
        notes: '',
        noteOpen: false,
        state: 'pending',
      }
      accepted.push(entry)
      assetPromises.current.set(
        entry.key,
        prepareUploadAssets(file).then((assets) => {
          setEntries((prev) => prev.map((e) => (e.key === entry.key ? { ...e, ...assets } : e)))
          return assets
        }),
      )
    }
    if (accepted.length) setEntries((prev) => [...prev, ...accepted])
    if (rejected.length) setError(`Skipped: ${rejected.join(', ')}`)
  }

  const patchEntry = (key: string, patch: Partial<Entry>) =>
    setEntries((prev) => prev.map((entry) => (entry.key === key ? { ...entry, ...patch } : entry)))

  const postChunk = (form: FormData, onProgress: (loaded: number) => void) =>
    new Promise<void>((resolve, reject) => {
      const xhr = new XMLHttpRequest()
      xhr.open('POST', '/api/upload')
      xhr.upload.onprogress = (event) => {
        if (event.lengthComputable) onProgress(event.loaded)
      }
      xhr.onload = () => {
        if (xhr.status < 300) return resolve()
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
    const uploadId = crypto.randomUUID()
    let offset = 0
    while (offset < file.size) {
      const end = Math.min(offset + CHUNK_BYTES, file.size)
      const isFinal = end >= file.size
      const form = new FormData()
      form.set('uploadId', uploadId)
      form.set('offset', String(offset))
      form.set('chunk', file.slice(offset, end))
      if (isFinal) {
        // The thumbnail/preview may still be generating in the worker.
        const assets = (await assetPromises.current.get(entry.key)) ?? {}
        form.set('final', '1')
        form.set('fileName', file.name)
        form.set('name', entry.name.trim() || file.name.replace(/\.stl$/i, ''))
        form.set('quantity', String(Math.min(50, Math.max(1, Math.round(Number(entry.quantity) || 1)))))
        form.set('requesterName', forName)
        form.set('notes', entry.notes)
        if (assets.thumbnail) form.set('thumbnail', assets.thumbnail)
        if (assets.preview) form.set('preview', assets.preview)
      }
      const chunkStart = offset
      await postChunk(form, (loaded) =>
        setProgress(base + (Math.min(chunkStart + loaded, file.size) / file.size) * share),
      )
      offset = end
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
        patchEntry(entry.key, { state: 'done' })
      } catch (err) {
        failures++
        posthog.captureException(err, {
          action: 'upload_stl',
          file_size_bytes: entry.file.size,
          has_preview: !!entry.preview,
        })
        patchEntry(entry.key, { state: 'error' })
        setError(err instanceof Error ? err.message : 'Upload failed.')
      }
    }
    if (failures === 0) {
      posthog.capture('print_job_submitted', {
        file_count: pending.length,
        for_name: forName,
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
                  {entry.noteOpen ? (
                    <textarea
                      aria-label="Notes"
                      rows={2}
                      value={entry.notes}
                      onChange={(e) => patchEntry(entry.key, { notes: e.target.value })}
                      placeholder="scale, supports, colour — anything the printer should know"
                      disabled={entry.state === 'done'}
                    />
                  ) : (
                    entry.state === 'pending' && (
                      <button
                        type="button"
                        className="row-note-toggle"
                        onClick={() => patchEntry(entry.key, { noteOpen: true })}
                      >
                        + add note
                      </button>
                    )
                  )}
                </div>
              </div>
            ))}
          </div>
        )}

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
