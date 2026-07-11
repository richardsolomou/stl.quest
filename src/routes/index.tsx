import { useEffect, useRef, useState } from 'react'
import { createFileRoute, getRouteApi } from '@tanstack/react-router'
import { useQueryClient, useSuspenseQuery } from '@tanstack/react-query'
import { usePostHog } from '@posthog/react'
import { Board } from '../components/Board'
import { RequestModal } from '../components/RequestModal'
import { UploadForm } from '../components/UploadForm'
import { AuthScreen } from '../components/AuthScreen'
import { SettingsModal } from '../components/SettingsModal'
import { requestsQuery, peopleQuery } from '../lib/queries'

const rootRoute = getRouteApi('__root__')

export const Route = createFileRoute('/')({ component: Home })

function Home() {
  const session = rootRoute.useLoaderData()
  if (!session.identity) return <AuthScreen setupRequired={session.setupRequired} trustedHeader={session.authProvider === 'trusted-header'} />
  return <AuthenticatedHome />
}

function AuthenticatedHome() {
  const { identity, workflow, authProvider } = rootRoute.useLoaderData()
  const me = identity!
  const { data: requests } = useSuspenseQuery(requestsQuery())
  useSuspenseQuery(peopleQuery())
  const queryClient = useQueryClient()
  const posthog = usePostHog()
  const [uploadOpen, setUploadOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [droppedFiles, setDroppedFiles] = useState<File[]>([])
  const [fileDragActive, setFileDragActive] = useState(false)
  const [openRequestId, setOpenRequestId] = useState<string | null>(null)
  const uploadOpenRef = useRef(uploadOpen)
  uploadOpenRef.current = uploadOpen

  useEffect(() => {
    const events = new EventSource('/api/events')
    events.onopen = () => {
      void queryClient.invalidateQueries({ queryKey: ['requests'] })
      void queryClient.invalidateQueries({ queryKey: ['people'] })
    }
    events.addEventListener('change', () => {
      void queryClient.invalidateQueries({ queryKey: ['requests'] })
      void queryClient.invalidateQueries({ queryKey: ['people'] })
    })
    return () => events.close()
  }, [queryClient])

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
          <button type="button" className="btn" aria-label="Settings" onClick={() => setSettingsOpen(true)}>⚙</button>
          <button type="button" className="btn btn-primary add-print" onClick={() => { posthog.capture('upload_opened', { source: 'button' }); setUploadOpen(true) }}>Add a print</button>
        </div>
      </header>
      <Board requests={requests} workflow={workflow} isAdmin={me.role === 'operator'} onOpenRequest={(id) => { setOpenRequestId(id); posthog.capture('request_viewed', { request_id: id }) }} />
      {fileDragActive && !uploadOpen && <div className="drop-hint">Drop STLs to add prints</div>}
      {uploadOpen && <UploadForm myName={me.name} initialFiles={droppedFiles} onClose={() => { setUploadOpen(false); setDroppedFiles([]) }} />}
      {settingsOpen && <SettingsModal me={me} localAuth={authProvider === 'local'} onClose={() => setSettingsOpen(false)} />}
      {selectedRequest && <RequestModal request={selectedRequest} workflow={workflow} isAdmin={me.role === 'operator'} onClose={() => setOpenRequestId(null)} />}
    </div>
  )
}
