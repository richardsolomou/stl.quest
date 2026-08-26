import { useEffect, useRef } from 'react'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useMutation, useQuery, useQueryClient, useSuspenseQuery } from '@tanstack/react-query'
import { useServerFn } from '@tanstack/react-start'
import { useVirtualizer } from '@tanstack/react-virtual'
import { ArchiveRestore, ArchiveX, Link2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { AccountRouteShell } from '../client/components/AccountRouteShell'
import { ARCHIVE_SORT_GROUPS, BoardFilters } from '../client/components/BoardFilters'
import { LazyThumb } from '../client/components/LazyThumb'
import { QueryState } from '../client/components/QueryState'
import { UserAvatar } from '../client/components/UserAvatar'
import { VirtualRow } from '../client/components/VirtualRow'
import { SourcePreviewImage } from '../client/components/SourcePreviewImage'
import { requesterLabel } from '../client/requester'
import { filtersFromSearch, updateRequestSearch, validateRequestSearch } from '../client/boardSearch'
import { requestsQuery, sessionQuery } from '../client/queries'
import { retryQueries } from '../client/queryState'
import { useWorkspaceSlug } from '../client/workspace'
import { errorMessage } from '../core/error'
import { printGroupBranchIds } from '../core/printGroups'
import type { Identity, PublicPrintRequest } from '../core/types'
import { unarchiveRequests } from '../server/fns'

export const Route = createFileRoute('/archive')({ validateSearch: validateRequestSearch, component: ArchivePage })

function ArchivePage() {
  const navigate = useNavigate()
  const { data: session } = useSuspenseQuery(sessionQuery())
  useEffect(() => {
    if (!session.identity) void navigate({ to: '/' })
  }, [session.identity, navigate])
  if (!session.identity) return null
  return <AccountRouteShell active="archive">{(identity) => <ArchiveView identity={identity} />}</AccountRouteShell>
}

function ArchiveView({ identity }: { identity: Identity }) {
  const workspaceSlug = useWorkspaceSlug()
  const queryClient = useQueryClient()
  const search = Route.useSearch()
  const navigate = Route.useNavigate()
  const callUnarchiveRequests = useServerFn(unarchiveRequests)
  const { data: workspace } = useQuery(sessionQuery(workspaceSlug))
  const filters = { ...filtersFromSearch(search, 'archived-desc'), archived: true }
  const result = useQuery(requestsQuery(workspaceSlug, filters))
  const restoreMutation = useMutation({
    mutationFn: callUnarchiveRequests,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['requests', workspaceSlug] }),
  })
  if (result.isPending) {
    return (
      <div className="grid min-h-0 flex-1 place-items-center p-6">
        <QueryState
          loading
          error={undefined}
          loadingLabel="Loading archive…"
          errorTitle="Could not load the archive"
          onRetry={() => undefined}
        />
      </div>
    )
  }
  if (result.isError) {
    return (
      <div className="grid min-h-0 flex-1 place-items-center p-6">
        <QueryState
          loading={false}
          error={result.error}
          loadingLabel="Loading archive…"
          errorTitle="Could not load the archive"
          onRetry={() => void retryQueries(result.refetch)}
          className="w-full max-w-xl"
        />
      </div>
    )
  }
  const isAdmin = identity.role === 'admin'
  const showRequester = !workspace?.privateRequests || isAdmin
  const tags = result.data.groups
  const facets = result.data.facets
  const selectedTagIds = search.tag ? printGroupBranchIds(tags, search.tag) : undefined
  const archivedRequests = selectedTagIds
    ? result.data.requests.filter((request) => request.groups.some((tag) => selectedTagIds.has(tag.id)))
    : result.data.requests
  const filtered =
    search.tag !== undefined || Object.entries(filters).some(([key, value]) => key !== 'sort' && key !== 'archived' && value !== undefined)
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4">
      <header className="shrink-0">
        <h1 className="font-heading text-xl font-semibold">Archive</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Archived prints stay out of the board but keep their stage, source, files, and history. Move one back whenever you need it again.
        </p>
      </header>
      <BoardFilters
        className="-mx-5 shrink-0 px-5"
        search={search}
        facets={facets}
        tags={tags}
        sortGroups={ARCHIVE_SORT_GROUPS}
        defaultSort="archived-desc"
        ariaLabel="Archive filters"
        description="Combine any fields to narrow the archive."
        onChange={(patch, replace = false) => void navigate({ search: updateRequestSearch(search, patch), replace })}
      />
      {archivedRequests.length === 0 ? (
        <div className="grid place-items-center gap-3 rounded-xl border border-dashed border-blueprint/25 p-10 text-center">
          <ArchiveX aria-hidden="true" className="size-8 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">
            {filtered
              ? 'No archived prints match these filters.'
              : 'Nothing is archived yet. Right-click a print on the board and choose Archive.'}
          </p>
        </div>
      ) : (
        <ArchivedRequestList
          requests={archivedRequests}
          showRequester={showRequester}
          pending={restoreMutation.isPending}
          onRestore={(id) => restoreMutation.mutate({ data: { workspaceSlug, ids: [id] } })}
        />
      )}
      {restoreMutation.isPending && <output className="text-sm text-muted-foreground">Moving back to the board…</output>}
      {restoreMutation.isError && (
        <p role="alert" className="text-sm text-destructive">
          {errorMessage(restoreMutation.error, 'The print could not be moved back to the board.')}
        </p>
      )}
    </div>
  )
}

function ArchivedRequestList({
  requests,
  showRequester,
  pending,
  onRestore,
}: {
  requests: PublicPrintRequest[]
  showRequester: boolean
  pending: boolean
  onRestore: (id: string) => void
}) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const virtualizer = useVirtualizer({
    count: requests.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 94,
    overscan: 12,
  })
  return (
    <div ref={scrollRef} className="app-scrollbar min-h-0 flex-1 overflow-y-auto">
      <div className="relative w-full" style={{ height: virtualizer.getTotalSize() }}>
        {virtualizer.getVirtualItems().map((item) => {
          const request = requests[item.index]
          return (
            <VirtualRow
              key={request.id}
              index={item.index}
              start={item.start}
              measureElement={virtualizer.measureElement}
              className="pb-2.5"
            >
              <ArchivedRequestRow
                request={request}
                showRequester={showRequester}
                pending={pending}
                onRestore={() => onRestore(request.id)}
              />
            </VirtualRow>
          )
        })}
      </div>
    </div>
  )
}

function ArchivedRequestRow({
  request,
  showRequester,
  pending,
  onRestore,
}: {
  request: PublicPrintRequest
  showRequester: boolean
  pending: boolean
  onRestore: () => void
}) {
  return (
    <div className="flex items-center gap-3 rounded-lg border bg-card p-2.5">
      {request.hasThumbnail ? (
        <LazyThumb requestId={request.id} />
      ) : request.hasSourceImage ? (
        <SourcePreviewImage
          key={request.id}
          requestId={request.id}
          className="thumb size-16 shrink-0 rounded-sm border object-cover"
          fallback={
            <div className="thumb grid size-16 shrink-0 place-items-center overflow-hidden rounded-sm border bg-background [background-image:var(--grid)] [background-size:12px_12px]">
              <Link2 className="size-6 text-primary" aria-label="Linked print" />
            </div>
          }
        />
      ) : (
        <div className="thumb grid size-16 shrink-0 place-items-center overflow-hidden rounded-sm border border-ticket-foreground/15 bg-background [background-image:var(--grid)] [background-size:12px_12px]">
          {request.hasFile ? (
            <span className="font-mono text-[10px] text-muted-foreground">stl</span>
          ) : (
            <Link2 className="size-6 text-primary" aria-label="Linked print" />
          )}
        </div>
      )}
      <div className="min-w-0 flex-1">
        <div className="truncate font-serif text-base font-semibold">{request.name}</div>
        <div className="mt-1 flex items-center gap-x-2 text-xs text-muted-foreground">
          {showRequester && (
            <>
              <UserAvatar name={requesterLabel(request)} image={request.requesterImage} size="sm" />
              <span>{requesterLabel(request)}</span>
            </>
          )}
          <span className="font-mono">×{request.quantity}</span>
          {request.archivedAt && (
            <span title={`Archived ${formatDateTime(request.archivedAt)}`}>
              Archived <time dateTime={new Date(request.archivedAt).toISOString()}>{formatDate(request.archivedAt)}</time>
            </span>
          )}
        </div>
      </div>
      {request.canArchive && (
        <Button type="button" variant="outline" size="sm" disabled={pending} onClick={onRestore}>
          <ArchiveRestore />
          Move back
        </Button>
      )}
    </div>
  )
}

function formatDate(value: number) {
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(value)
}

function formatDateTime(value: number) {
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(value)
}
