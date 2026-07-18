import { useEffect, useMemo, useRef, useState } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { useMutation, useQuery, useQueryClient, useSuspenseQuery } from '@tanstack/react-query'
import { useServerFn } from '@tanstack/react-start'
import { usePostHog } from '@posthog/react'
import { Plus } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { AppHeader } from '../client/components/AppHeader'
import { Board } from '../client/components/Board'
import { BoardBulkActions } from '../client/components/BoardBulkActions'
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
import { enabledPrinters } from '../client/fleet'
import { useWorkspaceSlug } from '../client/workspace'
import { serializePlateBrief } from '../core/plateBrief'
import type { PrinterSummary, PublicPrintRequest } from '../core/types'
import { deleteRequest } from '../server/fns'
export const Route = createFileRoute('/')({ validateSearch: validateRequestSearch, component: Home })

const EMPTY_REQUESTS: PublicPrintRequest[] = []

function Home() {
  const queryClient = useQueryClient()
  const { data: session } = useSuspenseQuery(sessionQuery())
  if (!session.identity) return <AuthScreen setupRequired={session.setupRequired} hosted={session.hosted} auth={session.auth} />
  if (session.identity.role === 'admin' && (!session.storageConfigured || !session.storageReady || !session.printersConfigured)) {
    return (
      <div className="min-h-dvh">
        <AppHeader
          active="board"
          isAdmin
          isDeploymentAdmin={session.identity.deploymentAdmin}
          showPlanner={false}
          navigationEnabled={false}
        />
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
  const queryClient = useQueryClient()
  const search = Route.useSearch()
  const navigate = Route.useNavigate()
  const {
    data: { identity, workflow, privateRequests, printers },
  } = useSuspenseQuery(sessionQuery(workspaceSlug))
  const isAdmin = identity?.role === 'admin'
  const hideRequester = privateRequests && !isAdmin
  const activePrinters = enabledPrinters(printers)
  const filters = filtersFromSearch(search)
  const { data: result, isFetching } = useQuery(requestsQuery(workspaceSlug, filters))
  const [selectedRequests, setSelectedRequests] = useState<Record<string, PublicPrintRequest>>({})
  const { data: people = [] } = useQuery(peopleQuery(workspaceSlug))
  const requests = result?.requests ?? EMPTY_REQUESTS
  const showPrintTypes = true
  const facets = result?.facets ?? { requesters: [], total: 0, available: 0 }
  const posthog = usePostHog()
  const callDelete = useServerFn(deleteRequest)
  const [uploadOpen, setUploadOpen] = useState(false)
  const [droppedFiles, setDroppedFiles] = useState<File[]>([])
  const [fileDragActive, setFileDragActive] = useState(false)
  const [openRequestId, setOpenRequestId] = useState<string | null>(null)
  const uploadOpenRef = useRef(uploadOpen)
  uploadOpenRef.current = uploadOpen
  const selectedRequestIds = useMemo(() => new Set(Object.keys(selectedRequests)), [selectedRequests])
  const selectedPlateRequests = useMemo(() => Object.values(selectedRequests), [selectedRequests])
  const compatiblePlatePrinters = useMemo(
    () => activePrinters.filter((printer) => selectedPlateRequests.every((request) => requestCompatibleWithPrinter(request, printer))),
    [activePrinters, selectedPlateRequests],
  )
  const deleteMutation = useMutation({
    mutationFn: async (requestIds: string[]) => {
      await Promise.all(requestIds.map((id) => callDelete({ data: { workspaceSlug, id } })))
    },
    onSuccess: async (_result, requestIds) => {
      setSelectedRequests({})
      await queryClient.invalidateQueries({ queryKey: ['requests'] })
      toast.success(`${requestIds.length} ${requestIds.length === 1 ? 'request' : 'requests'} deleted.`)
    },
    onError: (failure) => {
      posthog.captureException(failure, { action: 'bulk_delete_requests' })
      toast.error("Couldn't delete the selected requests.")
    },
  })

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
      <AppHeader active="board" isAdmin={isAdmin} isDeploymentAdmin={me.deploymentAdmin} showPlanner={activePrinters.length > 0} />
      <BoardFilters
        search={search}
        facets={facets}
        isFetching={isFetching}
        onChange={(patch, replace = false) => void navigate({ to: '/', search: updateRequestSearch(search, patch), replace })}
        bulkActions={
          selectedPlateRequests.length ? (
            <BoardBulkActions
              count={selectedPlateRequests.length}
              canPlan={compatiblePlatePrinters.length > 0}
              deleting={deleteMutation.isPending}
              onPlan={() => {
                void navigate({ to: '/planner', search: { next: serializePlateBrief(selectedPlateRequests.map((request) => request.id)) } })
              }}
              onDelete={() => deleteMutation.mutate([...selectedRequestIds])}
              onClear={() => setSelectedRequests({})}
            />
          ) : undefined
        }
      />
      <Board
        requests={requests}
        workflow={workflow}
        isAdmin={isAdmin}
        showPrintTypes={showPrintTypes}
        filtered={Object.entries(filters).some(([key, value]) => key !== 'sort' && value !== undefined)}
        sort={filters.sort ?? 'board'}
        selectedRequestIds={isAdmin ? selectedRequestIds : undefined}
        onToggleRequestSelection={(request, selected) => {
          if (!selected) {
            setSelectedRequests((current) => {
              const { [request.id]: _removed, ...remaining } = current
              return remaining
            })
            return
          }
          const hasCompatiblePrinter = activePrinters.some((printer) =>
            [...selectedPlateRequests, request].every((candidate) => requestCompatibleWithPrinter(candidate, printer)),
          )
          if (!hasCompatiblePrinter) {
            toast.error('Those models cannot share a printer.')
            return
          }
          setSelectedRequests((current) => ({ ...current, [request.id]: request }))
        }}
        onOpenRequest={(id) => {
          setOpenRequestId(id)
          posthog.capture('request_viewed', { print_type: requests.find((request) => request.id === id)?.printType })
        }}
      />
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
      {!result && <div className="absolute inset-0 grid place-items-center bg-background/70 text-muted-foreground">Loading board…</div>}
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
      {selectedRequest && (
        <RequestModal request={selectedRequest} people={people} hideRequester={hideRequester} onClose={() => setOpenRequestId(null)} />
      )}
    </div>
  )
}

function requestCompatibleWithPrinter(request: PublicPrintRequest, printer: PrinterSummary) {
  if (request.printType !== printer.printType || request.fitState === 'none') return false
  return !request.compatiblePrinterIds?.length || request.compatiblePrinterIds.includes(printer.id)
}
