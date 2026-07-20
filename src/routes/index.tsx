import { useEffect, useRef, useState } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { useQuery, useQueryClient, useSuspenseQuery } from '@tanstack/react-query'
import { usePostHog } from '@posthog/react'
import { Plus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { AppHeader } from '../client/components/AppHeader'
import { Board } from '../client/components/Board'
import { RequestModal } from '../client/components/RequestModal'
import { UploadForm } from '../client/components/UploadForm'
import { StoragePane } from '../client/components/settings/StoragePane'
import { PrintersPane } from '../client/components/settings/PrintersPane'
import { AuthScreen } from '../client/components/AuthScreen'
import { BoardFilters } from '../client/components/BoardFilters'
import { filtersFromSearch, updateRequestSearch, validateRequestSearch } from '../client/boardSearch'
import { Brand } from '../client/components/Brand'
import { OnboardingProgress } from '../client/components/OnboardingProgress'
import { QueryState } from '../client/components/QueryState'
import { retryQueries } from '../client/queryState'
import { Card, CardContent, CardHeader } from '@/components/ui/card'
import { peopleQuery, requestsQuery, sessionQuery } from '../client/queries'
import { enabledPrinters } from '../client/fleet'
import { useWorkspaceSlug } from '../client/workspace'
import type { PublicPrintRequest } from '../core/types'
export const Route = createFileRoute('/')({ validateSearch: validateRequestSearch, component: Home })

const EMPTY_REQUESTS: PublicPrintRequest[] = []

function Home() {
  const queryClient = useQueryClient()
  const { data: session } = useSuspenseQuery(sessionQuery())
  if (!session.identity) return <AuthScreen setupRequired={session.setupRequired} hosted={session.hosted} auth={session.auth} />
  if (session.identity.role === 'admin' && (!session.storageConfigured || !session.storageReady || !session.printersConfigured)) {
    return (
      <div className="min-h-dvh">
        <AppHeader active="board" isAdmin isDeploymentAdmin={session.identity.deploymentAdmin} navigationEnabled={false} />
        <main className="grid min-h-[calc(100dvh-60px)] place-items-center p-6">
          <Card className="w-full max-w-[680px]">
            <CardHeader className="gap-4">
              <Brand />
              <OnboardingProgress
                step={!session.storageConfigured || !session.storageReady ? 3 : 4}
                accountLabel={session.hosted ? 'Account' : 'Admin'}
              />
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
      </div>
    )
  }
  return <AuthenticatedHome />
}

function AuthenticatedHome() {
  const workspaceSlug = useWorkspaceSlug()
  const search = Route.useSearch()
  const navigate = Route.useNavigate()
  const {
    data: { identity, workflow, privateRequests, printers },
  } = useSuspenseQuery(sessionQuery(workspaceSlug))
  const isAdmin = identity?.role === 'admin'
  const isWorkspaceOwner = identity?.workspaceRole === 'owner'
  const hideRequester = privateRequests && !isAdmin
  const activePrinters = enabledPrinters(printers)
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
  if (!identity) return null
  const me = identity
  return (
    <div className="relative flex h-dvh flex-col">
      <AppHeader active="board" isAdmin={isAdmin} isDeploymentAdmin={me.deploymentAdmin} />
      {result ? (
        <>
          <BoardFilters
            search={effectiveSearch}
            facets={facets}
            prioritySortLabel={isAdmin ? 'Requester priorities' : 'My priority'}
            showRoundRobin={isWorkspaceOwner}
            onChange={(patch, replace = false) => void navigate({ to: '/', search: updateRequestSearch(effectiveSearch, patch), replace })}
          />
          <Board
            requests={requests}
            workflow={workflow}
            isAdmin={isAdmin}
            showPrintTypes={showPrintTypes}
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
      <Button
        type="button"
        size="lg"
        className="fixed right-4 bottom-4 z-10 shadow-lg max-sm:size-11 max-sm:rounded-full max-sm:p-0"
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
          printers={activePrinters}
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
