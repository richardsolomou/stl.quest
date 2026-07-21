import { useEffect, useRef, useState } from 'react'
import { createFileRoute, Link } from '@tanstack/react-router'
import { useQuery, useQueryClient, useSuspenseQuery } from '@tanstack/react-query'
import { usePostHog } from '@posthog/react'
import { CircleAlert, Plus } from 'lucide-react'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader } from '@/components/ui/card'
import { AppRail } from '../client/components/AppRail'
import { Board } from '../client/components/Board'
import { RequestModal } from '../client/components/RequestModal'
import { UploadForm } from '../client/components/UploadForm'
import { AuthScreen } from '../client/components/AuthScreen'
import { BoardFilters } from '../client/components/BoardFilters'
import { Brand } from '../client/components/Brand'
import { OnboardingProgress } from '../client/components/OnboardingProgress'
import { filtersFromSearch, updateRequestSearch, validateRequestSearch } from '../client/boardSearch'
import { QueryState } from '../client/components/QueryState'
import { retryQueries } from '../client/queryState'
import { PrintersPane } from '../client/components/settings/PrintersPane'
import { StoragePane } from '../client/components/settings/StoragePane'
import { peopleQuery, requestsQuery, sessionQuery } from '../client/queries'
import { useWorkspaceSlug } from '../client/workspace'
import type { PublicPrintRequest } from '../core/types'
export const Route = createFileRoute('/')({ validateSearch: validateRequestSearch, component: Home })

const EMPTY_REQUESTS: PublicPrintRequest[] = []

function Home() {
  const queryClient = useQueryClient()
  const { data: session } = useSuspenseQuery(sessionQuery())
  const [storageSkipped, setStorageSkipped] = useState(false)
  const [printersSkipped, setPrintersSkipped] = useState(false)
  if (!session.identity) return <AuthScreen setupRequired={session.setupRequired} hosted={session.hosted} auth={session.auth} />
  if (session.identity.role === 'admin') {
    const storageIncomplete = !session.storageConfigured || !session.storageReady
    const showStorage = storageIncomplete && !storageSkipped
    const showPrinters = !showStorage && !session.printersConfigured && !printersSkipped
    if (showStorage || showPrinters) {
      return (
        <div className="flex h-dvh">
          <AppRail active="board" isAdmin isSuperAdmin={session.identity.superAdmin} navigationEnabled={false} />
          <main className="grid min-w-0 flex-1 place-items-center overflow-y-auto p-6">
            <Card className="w-full max-w-[680px]">
              <CardHeader className="gap-4">
                <Brand />
                <OnboardingProgress step={showStorage ? 3 : 4} accountLabel={session.hosted ? 'Account' : 'Super admin'} />
              </CardHeader>
              <CardContent className="flex flex-col gap-4">
                {showStorage ? (
                  <>
                    <StoragePane onboarding onSaved={() => void queryClient.invalidateQueries({ queryKey: ['session'] })} />
                    <Button type="button" variant="outline" onClick={() => setStorageSkipped(true)}>
                      Skip storage for now
                    </Button>
                  </>
                ) : (
                  <>
                    <PrintersPane onboarding onSaved={() => void queryClient.invalidateQueries({ queryKey: ['session'] })} />
                    <Button type="button" variant="outline" onClick={() => setPrintersSkipped(true)}>
                      Skip printers for now
                    </Button>
                  </>
                )}
              </CardContent>
            </Card>
          </main>
        </div>
      )
    }
  }
  return <AuthenticatedHome />
}

function AuthenticatedHome() {
  const workspaceSlug = useWorkspaceSlug()
  const search = Route.useSearch()
  const navigate = Route.useNavigate()
  const {
    data: { identity, workflow, privateRequests, printers, printersConfigured, storageConfigured, storageReady },
  } = useSuspenseQuery(sessionQuery(workspaceSlug))
  const isAdmin = identity?.role === 'admin'
  const isWorkspaceOwner = identity?.workspaceRole === 'owner'
  const hideRequester = privateRequests && !isAdmin
  const effectiveSearch = !isWorkspaceOwner && search.sort === 'round-robin' ? { ...search, sort: undefined } : search
  const filters = filtersFromSearch(effectiveSearch)
  const requestsResult = useQuery(requestsQuery(workspaceSlug, filters))
  const peopleResult = useQuery(peopleQuery(workspaceSlug))
  const result = requestsResult.data
  const people = peopleResult.data
  const requests = result?.requests ?? EMPTY_REQUESTS
  const showPrintTypes = true
  const facets = result?.facets ?? { requesters: [], total: 0, available: 0 }
  const posthog = usePostHog()
  const [uploadOpen, setUploadOpen] = useState(false)
  const [droppedFiles, setDroppedFiles] = useState<File[]>([])
  const [fileDragActive, setFileDragActive] = useState(false)
  const [openRequestId, setOpenRequestId] = useState<string | null>(null)
  const uploadOpenRef = useRef(uploadOpen)
  uploadOpenRef.current = uploadOpen

  useEffect(() => {
    if (!storageReady) {
      setFileDragActive(false)
      return
    }
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
  }, [posthog, storageReady])

  const selectedRequest = requests.find((request) => request.id === openRequestId)
  if (!identity) return null
  const me = identity
  return (
    <div className="relative flex h-dvh">
      <AppRail active="board" isAdmin={isAdmin} isSuperAdmin={me.superAdmin} />
      <div className="flex min-w-0 flex-1 flex-col">
        {((isAdmin && (!storageConfigured || !printersConfigured)) || !storageReady) && (
          <WorkspaceSetupNotice
            isAdmin={isAdmin}
            storageConfigured={storageConfigured}
            storageReady={storageReady}
            printersConfigured={printersConfigured}
          />
        )}
        {result ? (
          <>
            <BoardFilters
              search={effectiveSearch}
              facets={facets}
              prioritySortLabel={isAdmin ? 'Requester priorities' : 'My priority'}
              showRoundRobin={isWorkspaceOwner}
              onChange={(patch, replace = false) =>
                void navigate({ to: '/', search: updateRequestSearch(effectiveSearch, patch), replace })
              }
            />
            <Board
              requests={requests}
              workflow={workflow}
              isAdmin={isAdmin}
              showPrintTypes={showPrintTypes}
              uploadsEnabled={storageReady}
              filtered={Object.entries(filters).some(([key, value]) => key !== 'sort' && value !== undefined)}
              sort={effectiveSearch.sort ?? 'fair'}
              onOpenRequest={(id) => {
                setOpenRequestId(id)
                posthog.capture('request_viewed', { print_type: requests.find((request) => request.id === id)?.printType })
              }}
            />
          </>
        ) : (
          <main className="grid min-h-0 flex-1 place-items-center p-6">
            <QueryState
              loading={requestsResult.isPending}
              error={requestsResult.error}
              loadingLabel="Loading board…"
              errorTitle="Could not load the board"
              onRetry={() => void retryQueries(requestsResult.refetch)}
              className="w-full max-w-xl"
            />
          </main>
        )}
      </div>
      <Button
        type="button"
        size="lg"
        className="fixed right-4 bottom-4 z-10 shadow-lg max-sm:size-11 max-sm:rounded-full max-sm:p-0"
        disabled={!storageReady}
        title={storageReady ? undefined : 'Configure storage before adding prints'}
        onClick={() => {
          posthog.capture('upload_opened', { source: 'button' })
          setUploadOpen(true)
        }}
      >
        <Plus />
        <span className="max-sm:sr-only">Add a print</span>
      </Button>
      {fileDragActive && !uploadOpen && (
        <div className="pointer-events-none fixed inset-3 z-9 grid place-items-center rounded-lg border-2 border-dashed border-primary bg-background/85 font-heading text-lg tracking-wide uppercase text-primary">
          Drop STLs to add prints
        </div>
      )}
      {uploadOpen && (
        <UploadForm
          initialFiles={droppedFiles}
          printers={printers}
          onClose={() => {
            setUploadOpen(false)
            setDroppedFiles([])
          }}
        />
      )}
      {selectedRequest && people && (
        <RequestModal
          request={selectedRequest}
          people={people}
          hideRequester={hideRequester}
          isAdmin={isAdmin}
          printers={printers}
          onClose={() => setOpenRequestId(null)}
        />
      )}
    </div>
  )
}

function WorkspaceSetupNotice({
  isAdmin,
  storageConfigured,
  storageReady,
  printersConfigured,
}: {
  isAdmin: boolean
  storageConfigured: boolean
  storageReady: boolean
  printersConfigured: boolean
}) {
  if (!isAdmin) {
    return (
      <Alert className="m-3 mb-0">
        <CircleAlert />
        <AlertTitle>Uploads are temporarily unavailable</AlertTitle>
        <AlertDescription>A workspace admin needs to configure storage before prints can be added.</AlertDescription>
      </Alert>
    )
  }

  return (
    <Alert className="m-3 mb-0">
      <CircleAlert />
      <AlertTitle>Finish setting up your workspace when you’re ready</AlertTitle>
      <AlertDescription>
        You can explore PrintHub now and finish setup later.{' '}
        {(!storageConfigured || !storageReady) && (
          <>
            <Link to="/settings/$section" params={{ section: 'storage' }}>
              {storageReady ? 'Review storage' : 'Configure storage'}
            </Link>
            {!storageReady && ' to enable uploads'}
            {!printersConfigured && ', or '}
          </>
        )}
        {!printersConfigured && (
          <Link to="/settings/$section" params={{ section: 'printers' }}>
            add printers
          </Link>
        )}
        .
      </AlertDescription>
    </Alert>
  )
}
