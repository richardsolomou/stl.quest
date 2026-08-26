import { useEffect, useRef, useState } from 'react'
import { createFileRoute, Link } from '@tanstack/react-router'
import { useQuery, useQueryClient, useSuspenseQuery } from '@tanstack/react-query'
import { useMutation } from '@tanstack/react-query'
import { useServerFn } from '@tanstack/react-start'
import { usePostHog } from '@posthog/react'
import { CircleAlert, Plus } from 'lucide-react'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader } from '@/components/ui/card'
import { cn } from '@/lib/utils'
import { canAttachModel } from '../core/request'
import { AccountMenu } from '../client/components/AccountMenu'
import { AppRail } from '../client/components/AppRail'
import { Board } from '../client/components/Board'
import { RequestModal } from '../client/components/RequestModal'
import { UploadForm } from '../client/components/UploadForm'
import { AuthScreen } from '../client/components/AuthScreen'
import { BoardFilters } from '../client/components/BoardFilters'
import { BoardPresence } from '../client/components/BoardPresence'
import { Brand } from '../client/components/Brand'
import { OnboardingProgress } from '../client/components/OnboardingProgress'
import { ManageTagsDialog } from '../client/components/ManageTagsDialog'
import { filtersFromSearch, updateRequestSearch, validateRequestSearch } from '../client/boardSearch'
import { QueryState } from '../client/components/QueryState'
import { retryQueries } from '../client/queryState'
import { PrintersPane } from '../client/components/settings/PrintersPane'
import { StoragePane } from '../client/components/settings/StoragePane'
import { peopleQuery, requestsQuery, sessionQuery } from '../client/queries'
import { useWorkspaceSlug } from '../client/workspace'
import { needsStorageOnboarding, storageSetupState } from '../client/onboarding'
import type { PublicPrintRequest } from '../core/types'
import { printGroupBranchIds } from '../core/printGroups'
import { createPrintGroup, deletePrintGroup, updatePrintGroup } from '../server/fns'
import { errorMessage } from '../core/error'
export const Route = createFileRoute('/')({ validateSearch: validateRequestSearch, component: Home })

const EMPTY_REQUESTS: PublicPrintRequest[] = []

function Home() {
  const queryClient = useQueryClient()
  const search = Route.useSearch()
  const { data: session } = useSuspenseQuery(sessionQuery())
  const [reopenedStorage, setReopenedStorage] = useState(false)
  if (!session.identity) {
    return <AuthScreen setupRequired={session.setupRequired} hosted={session.hosted} auth={session.auth} creatingAccount={search.signup} />
  }
  if (session.identity.role === 'admin') {
    const showStorage = reopenedStorage || needsStorageOnboarding(session.storageConfigured)
    const showPrinters = !showStorage && !session.printersConfigured
    if (showStorage || showPrinters) {
      const leaveStorage = () => setReopenedStorage(false)
      return (
        <main className="h-dvh overflow-y-auto">
          <div className="mx-auto flex w-full max-w-[680px] flex-col p-4 sm:p-6">
            <Card>
              <CardHeader className="gap-4">
                <div className="flex items-start justify-between gap-3">
                  <Brand />
                  <AccountMenu isSuperAdmin={session.identity.superAdmin} side="bottom" />
                </div>
                {session.workspace && (
                  <p className="text-sm text-muted-foreground">
                    Setting up <span className="font-medium text-foreground">{session.workspace.name}</span>
                  </p>
                )}
                <OnboardingProgress step={showStorage ? 1 : 2} />
              </CardHeader>
              <CardContent className="flex flex-col gap-4">
                {showStorage ? (
                  <StoragePane
                    onboarding
                    onSaved={() => {
                      leaveStorage()
                      void queryClient.invalidateQueries({ queryKey: ['session'] })
                    }}
                    onKeepCurrent={leaveStorage}
                  />
                ) : (
                  <PrintersPane
                    onboarding
                    onSaved={() => void queryClient.invalidateQueries({ queryKey: ['session'] })}
                    onBack={() => setReopenedStorage(true)}
                  />
                )}
              </CardContent>
            </Card>
          </div>
        </main>
      )
    }
  }
  return <AuthenticatedHome />
}

function AuthenticatedHome() {
  const queryClient = useQueryClient()
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
  const tags = result?.groups ?? []
  const selectedTagIds = search.tag ? printGroupBranchIds(tags, search.tag) : undefined
  const visibleRequests = selectedTagIds ? requests.filter((request) => request.groups.some((tag) => selectedTagIds.has(tag.id))) : requests
  const showPrintTypes = true
  const facets = result?.facets ?? { requesters: [], total: 0, available: 0 }
  const posthog = usePostHog()
  const [uploadOpen, setUploadOpen] = useState(false)
  const [addMode, setAddMode] = useState<'upload' | 'link'>('upload')
  const [droppedFiles, setDroppedFiles] = useState<File[]>([])
  const [fileDragActive, setFileDragActive] = useState(false)
  const [openRequestId, setOpenRequestId] = useState<string | null>(null)
  const [manageTags, setManageTags] = useState(false)
  const [tagError, setTagError] = useState<string>()
  const refreshRequests = () => queryClient.invalidateQueries({ queryKey: ['requests', workspaceSlug] })
  const updateTagMutation = useMutation({ mutationFn: useServerFn(updatePrintGroup), onSuccess: refreshRequests })
  const deleteTagMutation = useMutation({ mutationFn: useServerFn(deletePrintGroup), onSuccess: refreshRequests })
  const createTagMutation = useMutation({ mutationFn: useServerFn(createPrintGroup), onSuccess: refreshRequests })
  const [droppedModel, setDroppedModel] = useState<File>()
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
      if (!files.length) return
      // An open print takes the drop itself, so a tweaked file lands on that card instead of adding a second one.
      if (modelDropTargetRef.current) {
        setDroppedModel(files[0])
        return
      }
      posthog.capture('upload_opened', { source: 'drop', file_count: files.length })
      setDroppedFiles(files)
      setAddMode('upload')
      setUploadOpen(true)
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
  const modelDropTarget = selectedRequest !== undefined && canAttachModel(selectedRequest, storageReady)
  const modelDropTargetRef = useRef(modelDropTarget)
  modelDropTargetRef.current = modelDropTarget
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
              tags={tags}
              onManageTags={isAdmin ? () => setManageTags(true) : undefined}
              prioritySortLabel={isAdmin ? 'Requester priorities' : 'My priority'}
              showRoundRobin={isWorkspaceOwner}
              presence={<BoardPresence workspaceSlug={workspaceSlug} visible={!hideRequester} />}
              action={
                <Button
                  type="button"
                  data-onboarding="upload"
                  onClick={() => {
                    posthog.capture('add_print_opened', { source: 'button' })
                    setAddMode('upload')
                    setUploadOpen(true)
                  }}
                >
                  <Plus />
                  <span className="max-sm:sr-only">Add a print</span>
                </Button>
              }
              onChange={(patch, replace = false) =>
                void navigate({ to: '/', search: updateRequestSearch(effectiveSearch, patch), replace })
              }
            />
            <Board
              requests={visibleRequests}
              groups={result.groups}
              workflow={workflow}
              isAdmin={isAdmin}
              showRequesters={!hideRequester}
              showPrintTypes={showPrintTypes}
              uploadsEnabled={storageReady}
              selectedTagIds={selectedTagIds}
              filtered={search.tag !== undefined || Object.entries(filters).some(([key, value]) => key !== 'sort' && value !== undefined)}
              sort={effectiveSearch.sort ?? 'fair'}
              onOpenRequest={(id) => {
                setOpenRequestId(id)
                const viewedRequest = requests.find((candidate) => candidate.id === id)
                const activeStatuses = viewedRequest
                  ? Object.entries(viewedRequest.counts)
                      .filter(([, count]) => count > 0)
                      .map(([status]) => status)
                  : []
                posthog.capture('request_viewed', {
                  print_type: viewedRequest?.printType,
                  viewer_relation: viewedRequest?.mine ? 'owner' : isAdmin ? 'operator' : 'other_requester',
                  active_statuses: activeStatuses,
                  has_started: activeStatuses.some((status) => status !== 'todo'),
                })
              }}
            />
            {manageTags && (
              <ManageTagsDialog
                tags={tags}
                pending={updateTagMutation.isPending || deleteTagMutation.isPending || createTagMutation.isPending}
                error={tagError}
                onCreate={async (name, parentId) => {
                  setTagError(undefined)
                  try {
                    return await createTagMutation.mutateAsync({
                      data: { workspaceSlug, name, parentId, status: workflow.statuses[0].id, items: [] },
                    })
                  } catch (error) {
                    setTagError(errorMessage(error, 'The tag could not be created.'))
                  }
                }}
                onSave={async (id, fields) => {
                  setTagError(undefined)
                  try {
                    await updateTagMutation.mutateAsync({ data: { workspaceSlug, id, ...fields } })
                    return true
                  } catch (error) {
                    setTagError(errorMessage(error, 'The tag could not be updated.'))
                    return false
                  }
                }}
                onDelete={async (tag) => {
                  setTagError(undefined)
                  try {
                    await deleteTagMutation.mutateAsync({ data: { workspaceSlug, id: tag.id } })
                  } catch (error) {
                    setTagError(errorMessage(error, 'The tag could not be deleted.'))
                  }
                }}
                onCancel={() => {
                  if (!updateTagMutation.isPending && !deleteTagMutation.isPending && !createTagMutation.isPending) {
                    setManageTags(false)
                    setTagError(undefined)
                  }
                }}
              />
            )}
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
      {fileDragActive && !uploadOpen && (
        <div
          className={cn(
            'pointer-events-none fixed inset-3 grid place-items-center rounded-lg border-2 border-dashed border-primary bg-background/85 font-heading text-lg tracking-wide uppercase text-primary',
            // Above the open print dialog, which is where the drop will land.
            modelDropTarget ? 'z-60' : 'z-9',
          )}
        >
          {modelDropTarget
            ? selectedRequest?.hasFile
              ? 'Drop a model to replace this one'
              : 'Drop a model to attach it'
            : 'Drop STLs to add prints'}
        </div>
      )}
      {uploadOpen && (
        <UploadForm
          initialFiles={droppedFiles}
          initialMode={addMode}
          printers={printers}
          uploadsEnabled={storageReady}
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
          uploadsEnabled={storageReady}
          droppedModel={droppedModel}
          onDroppedModelHandled={() => setDroppedModel(undefined)}
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
        <AlertDescription>
          A workspace admin needs to configure storage before files can be uploaded. Linked prints can still be added.
        </AlertDescription>
      </Alert>
    )
  }

  if (storageSetupState(storageConfigured, storageReady) === 'unavailable') {
    return (
      <Alert className="m-3 mb-0" variant="destructive">
        <CircleAlert />
        <AlertTitle>Storage unavailable</AlertTitle>
        <AlertDescription>
          STL Quest could not access the configured storage, so file uploads are disabled. Linked prints can still be added.{' '}
          <Link to="/settings/$section" params={{ section: 'storage' }}>
            Review storage
          </Link>
          .
        </AlertDescription>
      </Alert>
    )
  }

  return (
    <Alert className="m-3 mb-0">
      <CircleAlert />
      <AlertTitle>Finish setting up your workspace when you’re ready</AlertTitle>
      <AlertDescription>
        You can explore STL Quest now and finish setup later.{' '}
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
