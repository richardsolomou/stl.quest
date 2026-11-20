import { useRef } from 'react'
import { Link, createFileRoute } from '@tanstack/react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useServerFn } from '@tanstack/react-start'
import { useVirtualizer } from '@tanstack/react-virtual'
import { ArchiveRestore, ArchiveX, Link2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia } from '@/components/ui/empty'
import { AppShell } from '../client/components/AppShell'
import { PageHeader } from '../client/components/settings/SettingsLayout'
import { ARCHIVE_SORT_GROUPS, BoardFilters } from '../client/components/BoardFilters'
import { LazyThumb } from '../client/components/LazyThumb'
import { LocalDate } from '../client/components/LocalDate'
import { ModelFormatLabel } from '../client/components/ModelFormatLabel'
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
import { formatDateTime } from '../core/format'
import { printGroupBranchIds } from '../core/printGroups'
import type { PublicPrintRequest } from '../core/types'
import { unarchiveRequests } from '../server/fns'
import { useI18n } from '../client/i18n'

export const Route = createFileRoute('/archive')({ validateSearch: validateRequestSearch, component: ArchivePage })

function ArchivePage() {
  return (
    <AppShell active="archive" contained>
      <ArchiveView />
    </AppShell>
  )
}

function ArchiveView() {
  const { t } = useI18n()
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
          loadingLabel={t.requests.archive.loading}
          errorTitle={t.requests.archive.loadFailed}
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
          loadingLabel={t.requests.archive.loading}
          errorTitle={t.requests.archive.loadFailed}
          onRetry={() => void retryQueries(result.refetch)}
          className="w-full max-w-xl"
        />
      </div>
    )
  }
  const showRequester = !workspace?.ownRequestsOnly
  const tags = result.data.groups
  const facets = result.data.facets
  const selectedTagIds = search.tag ? printGroupBranchIds(tags, search.tag) : undefined
  const archivedRequests = selectedTagIds
    ? result.data.requests.filter((request) => request.groups.some((tag) => selectedTagIds.has(tag.id)))
    : result.data.requests
  const filtered =
    search.tag !== undefined || Object.entries(filters).some(([key, value]) => key !== 'sort' && key !== 'archived' && value !== undefined)
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-5">
      <PageHeader title={t.requests.archive.title} description={t.requests.archive.description} />
      <BoardFilters
        className="shrink-0 px-0 pt-0"
        search={search}
        facets={facets}
        tags={tags}
        sortGroups={ARCHIVE_SORT_GROUPS}
        defaultSort="archived-desc"
        ariaLabel={t.requests.archive.filtersLabel}
        description={t.requests.archive.filtersDescription}
        onChange={(patch, replace = false) => void navigate({ search: updateRequestSearch(search, patch), replace })}
      />
      {archivedRequests.length === 0 ? (
        <Empty className="flex-none border border-border/70 bg-card/40 py-12">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <ArchiveX aria-hidden="true" />
            </EmptyMedia>
            <h2 className="font-heading text-sm font-medium tracking-tight">
              {filtered ? t.requests.archive.noMatchesTitle : t.requests.archive.emptyTitle}
            </h2>
            <EmptyDescription>{filtered ? t.requests.archive.noMatches : t.requests.archive.empty}</EmptyDescription>
            {!filtered && workspace?.identity?.role === 'admin' && (
              <EmptyDescription>
                {t.requests.archive.autoArchive.before}
                <Link to="/settings/$section" params={{ section: 'board' }}>
                  {t.requests.archive.autoArchive.link}
                </Link>
                {t.requests.archive.autoArchive.after}
              </EmptyDescription>
            )}
          </EmptyHeader>
        </Empty>
      ) : (
        <ArchivedRequestList
          requests={archivedRequests}
          showRequester={showRequester}
          pending={restoreMutation.isPending}
          onRestore={(id) => restoreMutation.mutate({ data: { workspaceSlug, ids: [id] } })}
        />
      )}
      {restoreMutation.isPending && <output className="text-sm text-muted-foreground">{t.requests.archive.restoring}</output>}
      {restoreMutation.isError && (
        <p role="alert" className="text-sm text-destructive">
          {errorMessage(restoreMutation.error, t.requests.archive.restoreFailed)}
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
  const { t, locale } = useI18n()
  return (
    <div className="flex items-center gap-3 rounded-lg border bg-card p-2.5">
      {request.hasThumbnail ? (
        <LazyThumb request={request} />
      ) : request.hasSourceImage ? (
        <SourcePreviewImage
          key={request.id}
          request={request}
          className="thumb size-16 shrink-0 rounded-sm border object-cover"
          fallback={
            <div className="thumb grid size-16 shrink-0 place-items-center overflow-hidden rounded-sm border bg-thumb">
              <Link2 className="size-6 text-ticket-muted" aria-label={t.requests.thumb.linkedPrint} />
            </div>
          }
        />
      ) : (
        <div className="thumb grid size-16 shrink-0 place-items-center overflow-hidden rounded-sm border border-ticket-foreground/15 bg-thumb">
          {request.hasFile ? (
            <ModelFormatLabel format={request.modelFormat} />
          ) : (
            <Link2 className="size-6 text-ticket-muted" aria-label={t.requests.thumb.linkedPrint} />
          )}
        </div>
      )}
      <div className="min-w-0 flex-1">
        <div className="truncate font-serif text-base font-semibold">{request.name}</div>
        <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
          {showRequester && (
            <>
              <UserAvatar name={requesterLabel(request, t.requests.requesterFallback)} image={request.requesterImage} size="sm" />
              <span>{requesterLabel(request, t.requests.requesterFallback)}</span>
            </>
          )}
          <span className="font-mono">×{request.quantity}</span>
          {request.archivedAt && (
            <span title={t.requests.archive.archivedAt(formatDateTime(request.archivedAt, locale))}>
              {t.requests.archive.archivedOn.before}
              <LocalDate value={request.archivedAt} locale={locale} />
              {t.requests.archive.archivedOn.after}
            </span>
          )}
        </div>
      </div>
      {request.canArchive && (
        <Button type="button" variant="outline" size="sm" title={t.requests.archive.moveBack} disabled={pending} onClick={onRestore}>
          <ArchiveRestore />
          <span className="max-sm:sr-only">{t.requests.archive.moveBack}</span>
        </Button>
      )}
    </div>
  )
}
