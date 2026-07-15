import { useEffect, useRef, useState } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { useQuery, useQueryClient, useSuspenseQuery } from '@tanstack/react-query'
import { usePostHog } from '@posthog/react'
import { Button } from '@/components/ui/button'
import { AppHeader } from '../client/components/AppHeader'
import { Board } from '../client/components/Board'
import { RequestModal } from '../client/components/RequestModal'
import { UploadForm } from '../client/components/UploadForm'
import { StoragePane } from '../client/components/settings/StoragePane'
import { PrintersPane } from '../client/components/settings/PrintersPane'
import { AuthScreen } from '../client/components/AuthScreen'
import { BoardFilters, filtersFromSearch, updateRequestSearch, validateRequestSearch } from '../client/components/BoardFilters'
import { Brand } from '../client/components/Brand'
import { OnboardingProgress } from '../client/components/OnboardingProgress'
import { Card, CardContent, CardHeader } from '@/components/ui/card'
import { peopleQuery, requestsQuery, sessionQuery } from '../client/queries'
import { fleetTechnologies } from '../client/fleet'
export const Route = createFileRoute('/')({ validateSearch: validateRequestSearch, component: Home })

function Home() {
  const queryClient = useQueryClient()
  const { data: session } = useSuspenseQuery(sessionQuery())
  if (!session.identity) return <AuthScreen setupRequired={session.setupRequired} auth={session.auth} />
  if (session.identity.role === 'admin' && (!session.storageConfigured || !session.storageReady || !session.printersConfigured)) {
    return (
      <main className="grid min-h-dvh place-items-center p-6">
        <Card className="w-full max-w-[680px]">
          <CardHeader className="gap-4">
            <Brand />
            <OnboardingProgress step={!session.storageConfigured || !session.storageReady ? 3 : 4} />
          </CardHeader>
          <CardContent>
            {!session.storageConfigured || !session.storageReady ? (
              <StoragePane onboarding onSaved={() => void queryClient.invalidateQueries({ queryKey: ['session'] })} />
            ) : (
              <PrintersPane onboarding onSaved={() => void queryClient.invalidateQueries({ queryKey: ['session'] })} />
            )}
          </CardContent>
        </Card>
      </main>
    )
  }
  return <AuthenticatedHome />
}

function AuthenticatedHome() {
  const search = Route.useSearch()
  const navigate = Route.useNavigate()
  const {
    data: { identity, workflow, privateRequests, printers },
  } = useSuspenseQuery(sessionQuery())
  const me = identity!
  const isAdmin = me.role === 'admin'
  const hideRequester = privateRequests && !isAdmin
  const showTechnologies = fleetTechnologies(printers).length > 1
  const filters = filtersFromSearch(search)
  const { data: result, isFetching } = useQuery(requestsQuery(filters))
  const { data: people = [] } = useQuery(peopleQuery())
  const requests = result?.requests ?? []
  const facets = result?.facets ?? { requesters: [], total: 0, available: 0 }
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
    const onDragEnter = (event: DragEvent) => {
      if (hasFiles(event)) {
        depth++
        if (!uploadOpenRef.current) setFileDragActive(true)
      }
    }
    const onDragOver = (event: DragEvent) => {
      if (hasFiles(event)) event.preventDefault()
    }
    const onDragLeave = (event: DragEvent) => {
      if (hasFiles(event)) {
        depth = Math.max(0, depth - 1)
        if (!depth) setFileDragActive(false)
      }
    }
    const onDrop = (event: DragEvent) => {
      if (!hasFiles(event)) return
      event.preventDefault()
      depth = 0
      setFileDragActive(false)
      if (uploadOpenRef.current) return
      const files = Array.from(event.dataTransfer?.files ?? [])
      if (files.length) {
        posthog.capture('upload_opened', { source: 'drop', file_count: files.length })
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
  }, [posthog])

  const selectedRequest = requests.find((request) => request.id === openRequestId)
  return (
    <div className="relative flex h-dvh flex-col">
      <AppHeader active="board" isAdmin={isAdmin} showPlanner={printers.length > 0}>
        <Button
          type="button"
          onClick={() => {
            posthog.capture('upload_opened', { source: 'button' })
            setUploadOpen(true)
          }}
        >
          Add a print
        </Button>
      </AppHeader>
      <BoardFilters
        search={search}
        facets={facets}
        printers={printers}
        isFetching={isFetching}
        onChange={(patch, replace = false) => void navigate({ to: '/', search: updateRequestSearch(search, patch), replace })}
      />
      <Board
        requests={requests}
        workflow={workflow}
        isAdmin={isAdmin}
        showTechnologies={showTechnologies}
        printers={printers}
        filtered={Object.entries(filters).some(([key, value]) => key !== 'sort' && value !== undefined)}
        sort={filters.sort ?? 'board'}
        onOpenRequest={(id) => {
          setOpenRequestId(id)
          posthog.capture('request_viewed', { printer_technology: requests.find((request) => request.id === id)?.technology })
        }}
      />
      {!result && <div className="absolute inset-0 grid place-items-center bg-background/70 text-muted-foreground">Loading board…</div>}
      {fileDragActive && !uploadOpen && (
        <div className="pointer-events-none fixed inset-3 z-9 grid place-items-center rounded-lg border-2 border-dashed border-primary bg-background/85 font-heading text-lg tracking-wide uppercase text-primary">
          Drop STLs to add prints
        </div>
      )}
      {uploadOpen && (
        <UploadForm
          myName={me.name}
          chooseFor={!privateRequests}
          printers={printers}
          initialFiles={droppedFiles}
          onClose={() => {
            setUploadOpen(false)
            setDroppedFiles([])
          }}
        />
      )}
      {selectedRequest && (
        <RequestModal
          request={selectedRequest}
          people={people}
          printers={printers}
          isAdmin={isAdmin}
          hideRequester={hideRequester}
          onClose={() => setOpenRequestId(null)}
        />
      )}
    </div>
  )
}
