import { useEffect, useRef, useState } from 'react'
import { createFileRoute, getRouteApi } from '@tanstack/react-router'
import { useSuspenseQuery } from '@tanstack/react-query'
import { convexQuery } from '@convex-dev/react-query'
import { api } from '../../convex/_generated/api'
import { Board } from '../components/Board'
import { JobModal } from '../components/JobModal'
import { UploadForm } from '../components/UploadForm'

const rootRoute = getRouteApi('__root__')

export const Route = createFileRoute('/')({
  loader: ({ context }) =>
    Promise.all([
      context.queryClient.ensureQueryData(convexQuery(api.jobs.list, {})),
      context.queryClient.ensureQueryData(convexQuery(api.users.list, {})),
    ]),
  component: Home,
})

function Home() {
  const me = rootRoute.useLoaderData()
  const { data: jobs } = useSuspenseQuery(convexQuery(api.jobs.list, {}))
  const [uploadOpen, setUploadOpen] = useState(false)
  const [droppedFiles, setDroppedFiles] = useState<File[]>([])
  const [fileDragActive, setFileDragActive] = useState(false)
  const [openJobId, setOpenJobId] = useState<string | null>(null)
  const uploadOpenRef = useRef(uploadOpen)
  uploadOpenRef.current = uploadOpen

  // Dropping STLs anywhere on the board opens the upload dialog pre-filled.
  useEffect(() => {
    let depth = 0
    const hasFiles = (event: DragEvent) => event.dataTransfer?.types.includes('Files') ?? false
    const onDragEnter = (event: DragEvent) => {
      if (!hasFiles(event)) return
      depth++
      if (!uploadOpenRef.current) setFileDragActive(true)
    }
    const onDragOver = (event: DragEvent) => {
      if (hasFiles(event)) event.preventDefault()
    }
    const onDragLeave = (event: DragEvent) => {
      if (!hasFiles(event)) return
      depth = Math.max(0, depth - 1)
      if (depth === 0) setFileDragActive(false)
    }
    const onDrop = (event: DragEvent) => {
      if (!hasFiles(event)) return
      event.preventDefault()
      depth = 0
      setFileDragActive(false)
      if (uploadOpenRef.current) return // the dialog's dropzone owns drops while open
      const files = Array.from(event.dataTransfer?.files ?? [])
      if (files.length) {
        setDroppedFiles(files)
        setUploadOpen(true)
      }
    }
    window.addEventListener('dragenter', onDragEnter)
    window.addEventListener('dragover', onDragOver)
    window.addEventListener('dragleave', onDragLeave)
    window.addEventListener('drop', onDrop)
    return () => {
      window.removeEventListener('dragenter', onDragEnter)
      window.removeEventListener('dragover', onDragOver)
      window.removeEventListener('dragleave', onDragLeave)
      window.removeEventListener('drop', onDrop)
    }
  }, [])

  const closeUpload = () => {
    setUploadOpen(false)
    setDroppedFiles([])
  }

  const openJob = jobs.find((job) => job._id === openJobId)

  return (
    <div className="app">
      <header className="header">
        <h1>
          Print<span className="accent">Queue</span>
        </h1>
        <button type="button" className="btn btn-primary" onClick={() => setUploadOpen(true)}>
          Add a print
        </button>
      </header>

      <Board jobs={jobs} isAdmin={me.isAdmin} onOpenJob={setOpenJobId} />

      {fileDragActive && !uploadOpen && <div className="drop-hint">Drop STLs to add prints</div>}
      {uploadOpen && <UploadForm myName={me.name} initialFiles={droppedFiles} onClose={closeUpload} />}
      {openJob && (
        <JobModal job={openJob} isAdmin={me.isAdmin} userEmail={me.email} onClose={() => setOpenJobId(null)} />
      )}
    </div>
  )
}
