import { Suspense, lazy, useRef, useState } from 'react'
import { useSuspenseQuery } from '@tanstack/react-query'
import { convexQuery } from '@convex-dev/react-query'
import { api } from '../../convex/_generated/api'
import { renderStlThumbnail } from '../lib/thumbnail'

const StlViewer = lazy(() => import('./StlViewer'))

const MAX_FILE_BYTES = 95 * 1024 * 1024

export function UploadForm({ myName, onClose }: { myName: string; onClose: () => void }) {
  const { data: people } = useSuspenseQuery(convexQuery(api.users.list, {}))
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [file, setFile] = useState<File | null>(null)
  const [name, setName] = useState('')
  const [quantity, setQuantity] = useState(1)
  const [forName, setForName] = useState(myName)
  const [notes, setNotes] = useState('')
  const [dragOver, setDragOver] = useState(false)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState<number | null>(null)

  const pickFile = (picked: File | undefined) => {
    setError('')
    if (!picked) return
    if (!/\.stl$/i.test(picked.name)) {
      setError('Only .stl files are accepted.')
      return
    }
    if (picked.size > MAX_FILE_BYTES) {
      setError('That file is over the 95 MB limit.')
      return
    }
    setFile(picked)
    if (!name.trim()) setName(picked.name.replace(/\.stl$/i, '').replace(/[_-]+/g, ' ').trim())
  }

  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    if (!file) {
      setError('Pick an STL file first.')
      return
    }
    setBusy(true)
    setError('')
    try {
      const form = new FormData()
      form.set('file', file)
      form.set('name', name.trim() || file.name.replace(/\.stl$/i, ''))
      form.set('quantity', String(quantity))
      form.set('requesterName', forName)
      form.set('notes', notes)
      const thumbnail = await renderStlThumbnail(file)
      if (thumbnail) form.set('thumbnail', thumbnail)

      await new Promise<void>((resolve, reject) => {
        const xhr = new XMLHttpRequest()
        xhr.open('POST', '/api/upload')
        xhr.upload.onprogress = (event) => {
          if (event.lengthComputable) setProgress(event.loaded / event.total)
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
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload failed. Try again.')
      setBusy(false)
      setProgress(null)
    }
  }

  return (
    <div className="overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <form className="dialog" onSubmit={submit}>
        <h2>Add a print</h2>

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
            pickFile(e.dataTransfer.files[0])
          }}
        >
          {file ? <span className="filename">{file.name}</span> : 'Drop an STL here, or click to browse'}
        </div>
        <input
          ref={fileInputRef}
          type="file"
          accept=".stl"
          hidden
          onChange={(e) => pickFile(e.target.files?.[0])}
        />

        {file && (
          <Suspense
            fallback={
              <div className="viewer">
                <div className="viewer-status">loading viewer…</div>
              </div>
            }
          >
            <StlViewer file={file} />
          </Suspense>
        )}

        <div className="field">
          <label htmlFor="upload-name">Name</label>
          <input
            id="upload-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Ork Warboss"
            maxLength={120}
            required
          />
        </div>

        <div className="field-row">
          <div className="field">
            <label htmlFor="upload-qty">Copies</label>
            <input
              id="upload-qty"
              type="number"
              min={1}
              max={50}
              value={quantity}
              onChange={(e) => setQuantity(Number(e.target.value))}
              required
            />
          </div>
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
        </div>

        <div className="field">
          <label htmlFor="upload-notes">Notes (optional)</label>
          <textarea
            id="upload-notes"
            rows={3}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="scale, supports, colour — anything the printer should know"
          />
        </div>

        {error && <p className="error">{error}</p>}
        {progress !== null && (
          <div className="progress" role="progressbar" aria-valuenow={Math.round(progress * 100)}>
            <div className="fill" style={{ width: `${Math.round(progress * 100)}%` }} />
          </div>
        )}

        <div className="dialog-actions">
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="btn btn-primary" disabled={busy}>
            {busy ? (progress !== null ? `Uploading… ${Math.round(progress * 100)}%` : 'Uploading…') : 'Add to queue'}
          </button>
        </div>
      </form>
    </div>
  )
}
