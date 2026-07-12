import { useEffect, useRef, useState } from 'react'
import { Link, createFileRoute } from '@tanstack/react-router'
import { useSuspenseQuery } from '@tanstack/react-query'
import { usePostHog } from '@posthog/react'
import { Board } from '../client/components/Board'
import { RequestModal } from '../client/components/RequestModal'
import { UploadForm } from '../client/components/UploadForm'
import { AuthScreen } from '../client/components/AuthScreen'
import { requestsQuery, peopleQuery, sessionQuery } from '../client/queries'

export const Route = createFileRoute('/')({ component: Home })

function Home() {
  const { data: session } = useSuspenseQuery(sessionQuery())
  if (!session.identity) return <AuthScreen setupRequired={session.setupRequired} />
  return <AuthenticatedHome />
}

function AuthenticatedHome() {
  const { data: { identity, workflow, privateRequests } } = useSuspenseQuery(sessionQuery())
  const me = identity!
  const isAdmin = me.role === 'operator'
  const hideRequester = privateRequests && !isAdmin
  const { data: requests } = useSuspenseQuery(requestsQuery())
  useSuspenseQuery(peopleQuery())
  const posthog = usePostHog()
  const [uploadOpen, setUploadOpen] = useState(false)
  const [droppedFiles, setDroppedFiles] = useState<File[]>([])
  const [fileDragActive, setFileDragActive] = useState(false)
  const [openRequestId, setOpenRequestId] = useState<string | null>(null)
  const uploadOpenRef = useRef(uploadOpen)
  uploadOpenRef.current = uploadOpen

  useEffect(() => {
    let depth = 0
    const hasFiles = (event: DragEvent) => event.dataTransfer?.types.includes('Files') ?? false
    const onDragEnter = (event: DragEvent) => { if (hasFiles(event)) { depth++; if (!uploadOpenRef.current) setFileDragActive(true) } }
    const onDragOver = (event: DragEvent) => { if (hasFiles(event)) event.preventDefault() }
    const onDragLeave = (event: DragEvent) => { if (hasFiles(event)) { depth = Math.max(0, depth - 1); if (!depth) setFileDragActive(false) } }
    const onDrop = (event: DragEvent) => {
      if (!hasFiles(event)) return
      event.preventDefault(); depth = 0; setFileDragActive(false)
      if (uploadOpenRef.current) return
      const files = Array.from(event.dataTransfer?.files ?? [])
      if (files.length) { posthog.capture('upload_opened', { source: 'drop', file_count: files.length }); setDroppedFiles(files); setUploadOpen(true) }
    }
    window.addEventListener('dragenter', onDragEnter); window.addEventListener('dragover', onDragOver); window.addEventListener('dragleave', onDragLeave); window.addEventListener('drop', onDrop)
    return () => { window.removeEventListener('dragenter', onDragEnter); window.removeEventListener('dragover', onDragOver); window.removeEventListener('dragleave', onDragLeave); window.removeEventListener('drop', onDrop) }
  }, [posthog])

  const selectedRequest = requests.find((request) => request.id === openRequestId)
  return (
    <div className="app">
      <header className="header">
        <h1 className="logo">Print<span className="accent">Hub</span></h1>
        <span className="who">v{__APP_VERSION__}</span>
        <span className="header-spacer" />
        <div className="header-actions">
          {isAdmin && <Link to="/settings" className="btn btn-icon" aria-label="Settings">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <circle cx="12" cy="12" r="3.2" />
              <path d="M19.4 15a1.7 1.7 0 0 0 .34 1.87l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.7 1.7 0 0 0-1.87-.34 1.7 1.7 0 0 0-1.03 1.56V21a2 2 0 1 1-4 0v-.09a1.7 1.7 0 0 0-1.11-1.56 1.7 1.7 0 0 0-1.87.34l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.7 1.7 0 0 0 .34-1.87 1.7 1.7 0 0 0-1.56-1.03H3a2 2 0 1 1 0-4h.09a1.7 1.7 0 0 0 1.56-1.11 1.7 1.7 0 0 0-.34-1.87l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.7 1.7 0 0 0 1.87.34h.08a1.7 1.7 0 0 0 1.03-1.56V3a2 2 0 1 1 4 0v.09a1.7 1.7 0 0 0 1.03 1.56 1.7 1.7 0 0 0 1.87-.34l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.7 1.7 0 0 0-.34 1.87v.08a1.7 1.7 0 0 0 1.56 1.03H21a2 2 0 1 1 0 4h-.09a1.7 1.7 0 0 0-1.51 1.03Z" />
            </svg>
          </Link>}
          <button type="button" className="btn btn-primary add-print" onClick={() => { posthog.capture('upload_opened', { source: 'button' }); setUploadOpen(true) }}>Add a print</button>
        </div>
      </header>
      <Board requests={requests} workflow={workflow} isAdmin={isAdmin} hideRequester={hideRequester} onOpenRequest={(id) => { setOpenRequestId(id); posthog.capture('request_viewed', { request_id: id }) }} />
      {fileDragActive && !uploadOpen && <div className="drop-hint">Drop STLs to add prints</div>}
      {uploadOpen && <UploadForm myName={me.name} chooseFor={!privateRequests} initialFiles={droppedFiles} onClose={() => { setUploadOpen(false); setDroppedFiles([]) }} />}
      {selectedRequest && <RequestModal request={selectedRequest} workflow={workflow} isAdmin={isAdmin} hideRequester={hideRequester} onClose={() => setOpenRequestId(null)} />}
    </div>
  )
}
