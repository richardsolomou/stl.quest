import { useRef, useState } from 'react'
import { renderStlThumbnail } from '../lib/thumbnail'

const MAX_FILE_BYTES = 95 * 1024 * 1024

export function UploadForm({ onClose }: { onClose: () => void }) {
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [file, setFile] = useState<File | null>(null)
  const [name, setName] = useState('')
  const [quantity, setQuantity] = useState(1)
  const [tags, setTags] = useState('')
  const [dragOver, setDragOver] = useState(false)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

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
      form.set('tags', tags)
      const thumbnail = await renderStlThumbnail(file)
      if (thumbnail) form.set('thumbnail', thumbnail)

      const res = await fetch('/api/upload', { method: 'POST', body: form })
      if (!res.ok) {
        const body = await res.json().catch(() => null)
        throw new Error(body?.error ?? `upload failed (${res.status})`)
      }
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload failed. Try again.')
      setBusy(false)
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
            <label htmlFor="upload-tags">Tags (comma-separated, optional)</label>
            <input
              id="upload-tags"
              value={tags}
              onChange={(e) => setTags(e.target.value)}
              placeholder="warhammer, orks"
            />
          </div>
        </div>

        {error && <p className="error">{error}</p>}

        <div className="dialog-actions">
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="btn btn-primary" disabled={busy}>
            {busy ? 'Uploading…' : 'Add to queue'}
          </button>
        </div>
      </form>
    </div>
  )
}
