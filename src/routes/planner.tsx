import { useQuery, useSuspenseQuery } from '@tanstack/react-query'
import { Link, createFileRoute, redirect } from '@tanstack/react-router'
import { Box, ChevronLeft, ChevronRight, Download, Settings, TriangleAlert } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import * as THREE from 'three'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button, buttonVariants } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Spinner } from '@/components/ui/spinner'
import { cn } from '@/lib/utils'
import { AppHeader } from '../client/components/AppHeader'
import { BoardFilters, filtersFromSearch, updateRequestSearch, validateRequestSearch } from '../client/components/BoardFilters'
import { preloadStlViewer } from '../client/components/LazyStlViewer'
import { PlateViewer } from '../client/components/PlateViewer'
import { RequestCard } from '../client/components/RequestCard'
import { RequestModal } from '../client/components/RequestModal'
import { loadPlateGeometry } from '../client/plateAnalysis'
import { exportPlate } from '../client/plateExport'
import { peopleQuery, platePlannerQuery, requestsQuery, sessionQuery } from '../client/queries'
import { enabledPrinters, printTypeLabel } from '../client/fleet'
import { savePlatePlannerDraft } from '../server/fns'
import type { ResinOrientation } from '../core/mesh/resinOrientation'
import {
  normalizePrinterProfile,
  ORIENTATION_ANALYSIS_VERSION,
  allocateFleetCandidates,
  analysisFitsPrinter,
  candidateFitsPrinter,
  modelAnalysisReady,
  orientationAnalysisReady,
  planPlates,
  placementIssues,
  type PlateCandidate,
  type FleetCandidate,
  type PlatePlacement,
  type PrinterProfile,
} from '../core/platePlanner'

export const Route = createFileRoute('/planner')({
  validateSearch: validateRequestSearch,
  beforeLoad: async ({ context }) => {
    const session = await context.queryClient.ensureQueryData(sessionQuery())
    if (session.identity?.role === 'admin' && enabledPrinters(session.printers).length === 0) throw redirect({ to: '/' })
  },
  component: PlannerPage,
})

const PLATE_LAYOUT_VERSION = 5
const EMPTY_PLACEMENTS: PlatePlacement[] = []
const EMPTY_PLATES: PlatePlacement[][] = []

const DEFAULT_PRINTERS: PrinterProfile[] = [
  {
    id: 'resin-medium',
    name: 'Printer 1',
    printType: 'resin',
    enabled: true,
    widthMm: 129,
    depthMm: 80,
    heightMm: 150,
    spacingMm: 5,
    supportMarginMm: 4,
    adhesionMarginMm: 2,
    heightAllowanceMm: 5,
    maxHeightDifferenceMm: 20,
  },
]

function PlannerPage() {
  const search = Route.useSearch()
  const navigate = Route.useNavigate()
  const { data: session } = useSuspenseQuery(sessionQuery())
  const workspaceSlug = session.identity?.workspaceSlug ?? ''
  const filters = filtersFromSearch(search, 'created-asc')
  const { data, isFetching } = useQuery({ ...requestsQuery(workspaceSlug, filters), enabled: Boolean(workspaceSlug) })
  const { data: allData } = useQuery({ ...requestsQuery(workspaceSlug, { sort: 'created-asc' }), enabled: Boolean(workspaceSlug) })
  const { data: people = [] } = useQuery({ ...peopleQuery(workspaceSlug), enabled: Boolean(workspaceSlug) })
  const { data: storedPlanner } = useQuery({ ...platePlannerQuery(workspaceSlug), enabled: Boolean(workspaceSlug) })
  const showPrintTypes = true
  const [printers, setPrinters] = useState(DEFAULT_PRINTERS)
  const [printerId, setPrinterId] = useState(DEFAULT_PRINTERS[0].id)
  const [geometries] = useState(() => new Map<string, THREE.BufferGeometry>())
  const [plans, setPlans] = useState<Record<string, PlatePlacement[][]>>({})
  const [plateIndex, setPlateIndex] = useState(0)
  const [geometryRevision, setGeometryRevision] = useState(0)
  const [error, setError] = useState<string>()
  const [exportingPlate, setExportingPlate] = useState(false)
  const [restored, setRestored] = useState(false)
  const [openRequestId, setOpenRequestId] = useState<string>()
  const generationRef = useRef(0)
  const generatedFingerprintRef = useRef<string | undefined>(undefined)

  const activePrinter = printers.find((printer) => printer.id === printerId) ?? printers[0]
  const plannedPlates = plans[activePrinter.id] ?? EMPTY_PLATES
  const placements = plannedPlates[plateIndex] ?? EMPTY_PLACEMENTS
  const outstanding = useMemo(
    () =>
      (data?.requests ?? []).filter((request) => {
        const printType = requestPrintType(request)
        return (request.counts.todo ?? 0) > 0 && !!printType && printers.some((printer) => printer.printType === printType)
      }),
    [data?.requests, printers],
  )
  const allOutstanding = useMemo(() => (allData?.requests ?? []).filter((request) => (request.counts.todo ?? 0) > 0), [allData?.requests])
  const issues = useMemo(() => placementIssues(placements, activePrinter), [placements, activePrinter])
  const invalidCopyIds = useMemo(() => new Set(issues.keys()), [issues])
  const plateContents = useMemo(() => {
    const contents = new Map<string, { requestId: string; count: number }>()
    for (const placement of placements) {
      const current = contents.get(placement.requestId) ?? {
        requestId: placement.requestId,
        count: 0,
      }
      current.count++
      contents.set(placement.requestId, current)
    }
    return [...contents.values()]
  }, [placements])
  const selectedRequest = allData?.requests.find((request) => request.id === openRequestId)
  const analysisJobs = useMemo(() => new Map(storedPlanner?.analysisJobs.map((job) => [job.requestId, job])), [storedPlanner?.analysisJobs])
  const analyses = useMemo(
    () => new Map(storedPlanner?.analyses.map((analysis) => [analysis.requestId, analysis])),
    [storedPlanner?.analyses],
  )
  const selectedOutstanding = outstanding.filter((request) => requestPrintType(request) === activePrinter.printType)
  const readyCount = selectedOutstanding.filter((request) => {
    const analysis = analyses.get(request.id)
    return modelAnalysisReady(analysis) && (requestPrintType(request) === 'filament' || orientationAnalysisReady(analysis))
  }).length
  const waitingCount = selectedOutstanding.length - readyCount
  const unfitRequests = useMemo(
    () =>
      allOutstanding.filter((request) => {
        const analysis = analyses.get(request.id)
        const printType = requestPrintType(request)
        return (
          !!printType &&
          modelAnalysisReady(analysis) &&
          !printers.some((profile) => profile.printType === printType && analysisFitsPrinter(analysis, profile))
        )
      }),
    [allOutstanding, analyses, printers],
  )
  const fingerprint = useMemo(() => plannerFingerprint(outstanding, printers, analyses), [analyses, outstanding, printers])

  useEffect(() => {
    preloadStlViewer()
  }, [])

  useEffect(() => {
    if (!storedPlanner || restored) return
    const profiles = storedPlanner.profiles?.length
      ? storedPlanner.profiles.map((profile) => normalizePrinterProfile(profile)).filter((profile) => profile.enabled)
      : DEFAULT_PRINTERS
    const drafts = plannerDrafts(storedPlanner)
    setPrinters(profiles)
    setPrinterId((current) => (profiles.some((profile) => profile.id === current) ? current : profiles[0].id))
    const storedAnalyses = new Map(storedPlanner.analyses.map((analysis) => [analysis.requestId, analysis]))
    const outstandingForProfiles = (data?.requests ?? []).filter((request) => {
      const printType = requestPrintType(request)
      return (request.counts.todo ?? 0) > 0 && !!printType && profiles.some((profile) => profile.printType === printType)
    })
    const storedFingerprint = plannerFingerprint(outstandingForProfiles, profiles, storedAnalyses)
    if (profiles.every((profile) => drafts[profile.id]?.fingerprint === storedFingerprint)) {
      setPlans(
        Object.fromEntries(
          profiles.map((profile) => {
            return [profile.id, draftPlates(drafts[profile.id])]
          }),
        ),
      )
      generatedFingerprintRef.current = storedFingerprint
    }
    setRestored(true)
  }, [data?.requests, restored, storedPlanner])

  const generate = useCallback(async () => {
    const generation = ++generationRef.current
    setError(undefined)
    try {
      const fleetCandidates: FleetCandidate[] = []
      for (const request of outstanding) {
        const analysis = analyses.get(request.id)
        const printType = requestPrintType(request)
        if (!printType || !modelAnalysisReady(analysis) || (printType === 'resin' && !orientationAnalysisReady(analysis))) continue
        const copyCount = request.counts.todo ?? 0
        for (let copy = 1; copy <= copyCount; copy++) {
          const copyId = `${request.id}:${copy}`
          const candidatesByPrinterId = Object.fromEntries(
            printers
              .filter((printer) => printer.printType === printType && analysisFitsPrinter(analysis, printer))
              .map((printer) => {
                const orientation = selectedOrientation(analysis, printer)
                const candidate: PlateCandidate = {
                  copyId,
                  requestId: request.id,
                  name: `${request.name} #${copy}`,
                  footprint: { widthMm: orientation.widthMm, depthMm: orientation.depthMm, known: true },
                  estimatedSupportedHeightMm: orientation.heightMm + (printer.printType === 'resin' ? printer.heightAllowanceMm : 0),
                  orientationQuaternion: orientation.quaternion,
                  orientationIslandCount: orientation.islandCount,
                  orientationRisk: orientation.islandRisk,
                }
                return [printer.id, candidate]
              }),
          )
          fleetCandidates.push({ copyId, candidatesByPrinterId })
        }
      }
      const assignments = allocateFleetCandidates(fleetCandidates, printers)
      const nextPlans = Object.fromEntries(printers.map((printer) => [printer.id, planPlates(assignments.get(printer.id) ?? [], printer)]))
      if (generation !== generationRef.current) return
      setPlans(Object.fromEntries(Object.entries(nextPlans).map(([profileId, result]) => [profileId, result.plates])))
      setPlateIndex(0)
      generatedFingerprintRef.current = fingerprint
      for (const printer of printers) {
        const result = nextPlans[printer.id]
        const draft: import('../core/platePlanner').PlatePlannerDraft = {
          fingerprint,
          printerId: printer.id,
          candidates: assignments.get(printer.id) ?? [],
          placements: result.plates[0] ?? [],
          plates: result.plates,
          skippedCount: result.skipped.length,
          savedAt: Date.now(),
        }
        await savePlatePlannerDraft({ data: { workspaceSlug, draft } })
      }
    } catch (cause) {
      if (generation === generationRef.current) setError(cause instanceof Error ? cause.message : 'Could not generate a plate')
    } finally {
      // Generation only packs cached server analyses; background workers own STL analysis.
    }
  }, [analyses, fingerprint, outstanding, printers, workspaceSlug])

  const downloadPlate = useCallback(async () => {
    if (!placements.length || exportingPlate) return
    const plate = placements
    const exportingIndex = plateIndex
    setError(undefined)
    setExportingPlate(true)
    try {
      const requestIds = [...new Set(plate.map((placement) => placement.requestId))]
      const models = await mapConcurrent(requestIds, 4, async (requestId) => {
        const request = allData?.requests.find((candidate) => candidate.id === requestId)
        const response = await fetch(`/api/files/${requestId}?inline=1`)
        if (!response.ok) throw new Error(`Could not download the original STL for ${request?.name ?? requestId}`)
        return { requestId, name: request?.name ?? requestId, buffer: await response.arrayBuffer() }
      })
      const archive = await exportPlate(plate, models)
      downloadFile(archive, `${fileNamePart(activePrinter.name)}-plate-${exportingIndex + 1}.3mf`, 'model/3mf')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not export this plate')
    } finally {
      setExportingPlate(false)
    }
  }, [activePrinter.name, allData?.requests, exportingPlate, placements, plateIndex])

  useEffect(() => {
    if (!restored || !storedPlanner || generatedFingerprintRef.current === fingerprint) return
    const drafts = plannerDrafts(storedPlanner)
    if (printers.every((printer) => drafts[printer.id]?.fingerprint === fingerprint)) {
      generatedFingerprintRef.current = fingerprint
      setPlans(
        Object.fromEntries(
          printers.map((printer) => {
            return [printer.id, draftPlates(drafts[printer.id])]
          }),
        ),
      )
      setPlateIndex(0)
      return
    }
    if (!outstanding.length) {
      generationRef.current++
      generatedFingerprintRef.current = fingerprint
      setPlans({})
      setPlateIndex(0)
      return
    }
    setPlans({})
    setPlateIndex(0)
    void generate()
  }, [fingerprint, generate, outstanding.length, printers, restored, storedPlanner])

  useEffect(() => {
    if (!placements.length) return
    const requestIds = [...new Set(placements.map((placement) => placement.requestId))]
    void mapConcurrent(requestIds, 4, async (requestId) => {
      if (geometries.has(requestId)) return
      const response = await fetch(`/api/files/${requestId}?inline=1&preview=1`)
      if (!response.ok) return
      geometries.set(requestId, await loadPlateGeometry(await response.arrayBuffer()))
      setGeometryRevision((current) => current + 1)
    })
  }, [geometries, placements, workspaceSlug])

  if (!session.identity) {
    return <main className="grid min-h-dvh place-items-center p-6">Sign in from the board to use the planner.</main>
  }
  if (session.identity.role !== 'admin') {
    return <main className="grid min-h-dvh place-items-center p-6">The plate planner is admin-only.</main>
  }

  return (
    <div className="min-h-dvh max-w-full overflow-x-hidden bg-muted/20">
      <AppHeader active="planner" isAdmin isDeploymentAdmin={session.identity.deploymentAdmin} />
      <main className="mx-auto w-full max-w-[1500px] min-w-0 p-3 sm:p-4 md:p-6">
        <BoardFilters
          search={search}
          facets={data?.facets ?? { requesters: [], total: 0, available: 0 }}
          isFetching={isFetching}
          defaultSort="created-asc"
          showSort={false}
          ariaLabel="Planner filters"
          description="Only matching queued copies are included when PrintHub generates build plates."
          className="mb-4 rounded-xl border bg-card px-3 pb-2.5"
          onChange={(patch, replace = false) =>
            void navigate({
              to: '/planner',
              search: updateRequestSearch(search, patch),
              replace,
            })
          }
        />
        {unfitRequests.length > 0 && (
          <Alert className="mb-4 border-amber-500/40 bg-amber-500/5">
            <TriangleAlert />
            <AlertTitle>
              {unfitRequests.length} queued {unfitRequests.length === 1 ? 'model does' : 'models do'} not fit any enabled printer
            </AlertTitle>
            <AlertDescription>
              <p>
                These analyzed models are excluded from generated plates. Check their scale or add a printer with a larger usable volume.
              </p>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {unfitRequests.map((request) => (
                  <Button key={request.id} type="button" variant="outline" size="xs" onClick={() => setOpenRequestId(request.id)}>
                    {request.name}
                  </Button>
                ))}
              </div>
            </AlertDescription>
          </Alert>
        )}
        <div className="grid min-w-0 gap-4 xl:grid-cols-[320px_minmax(0,1fr)]">
          <div className="min-w-0 space-y-4">
            <Card className="h-fit min-w-0">
              <CardHeader>
                <CardTitle>Printer</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div>
                  <Select
                    items={printers.map((printer) => ({
                      value: printer.id,
                      label: `${printer.name} · ${plans[printer.id]?.length ?? 0} ${(plans[printer.id]?.length ?? 0) === 1 ? 'plate' : 'plates'}`,
                    }))}
                    value={activePrinter.id}
                    onValueChange={(value) => {
                      if (!value || value === activePrinter.id) return
                      setPrinterId(value)
                      setPlateIndex(0)
                    }}
                  >
                    <SelectTrigger id="printer-profile" className="w-full" aria-label="Printer">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {printers.map((printer) => {
                        const plateCount = plans[printer.id]?.length ?? 0
                        return (
                          <SelectItem key={printer.id} value={printer.id}>
                            {printer.name} · {printTypeLabel(printer.printType)} · {plateCount} {plateCount === 1 ? 'plate' : 'plates'}
                          </SelectItem>
                        )
                      })}
                    </SelectContent>
                  </Select>
                </div>
                <Link
                  to="/settings/$section"
                  params={{ section: 'printers' }}
                  className={cn(buttonVariants({ variant: 'outline' }), 'w-full')}
                >
                  <Settings /> Manage printers
                </Link>
                <p className="text-xs text-muted-foreground">
                  {activePrinter.printType === 'resin'
                    ? 'Layouts use resin orientation analysis, configured support and adhesion margins, and supported-height grouping.'
                    : 'Layouts preserve the uploaded orientation, may rotate models 90° on the bed, and use the configured spacing and brim margin.'}{' '}
                  Exported 3MF files contain geometry and placement only; finish support, adhesion, and material settings in your slicer.
                </p>
              </CardContent>
            </Card>

            <Card className="min-w-0">
              <CardHeader>
                <CardTitle>Plate contents</CardTitle>
              </CardHeader>
              <CardContent className="max-h-[520px] space-y-2.5 overflow-auto p-2.5 pt-0">
                {plateContents.map((content) => {
                  const request = allData?.requests.find((candidate) => candidate.id === content.requestId)
                  if (!request) return null
                  return (
                    <RequestCard
                      key={content.requestId}
                      request={request}
                      status="todo"
                      count={content.count}
                      canDrag={false}
                      settling={false}
                      showPrintType={showPrintTypes}
                      showPrinter={false}
                      onOpen={() => {
                        preloadStlViewer()
                        setOpenRequestId(content.requestId)
                      }}
                    />
                  )
                })}
              </CardContent>
            </Card>
            {waitingCount > 0 && (
              <Card className="min-w-0">
                <CardHeader>
                  <CardTitle>Backlog analysis</CardTitle>
                </CardHeader>
                <CardContent className="max-h-72 space-y-3 overflow-auto">
                  {selectedOutstanding
                    .filter((request) => {
                      const analysis = analyses.get(request.id)
                      return !modelAnalysisReady(analysis) || (requestPrintType(request) === 'resin' && !orientationAnalysisReady(analysis))
                    })
                    .map((request) => {
                      const job = analysisJobs.get(request.id)
                      return (
                        <div key={request.id} className="space-y-0.5 text-sm">
                          <p className="truncate font-medium">{request.name}</p>
                          <p className={job?.status === 'failed' ? 'text-destructive' : 'text-muted-foreground'}>
                            {orientationJobLabel(job?.status, job?.error)}
                          </p>
                        </div>
                      )
                    })}
                </CardContent>
              </Card>
            )}
          </div>

          <Card className="min-w-0">
            <CardHeader>
              <div className="flex items-center justify-between gap-3">
                <CardTitle>{plannedPlates.length ? `Build plate ${plateIndex + 1} of ${plannedPlates.length}` : 'Build plate'}</CardTitle>
                <div className="flex items-center gap-1">
                  {placements.length > 0 && (
                    <Button type="button" variant="outline" size="sm" disabled={exportingPlate} onClick={() => void downloadPlate()}>
                      {exportingPlate ? <Spinner /> : <Download />}
                      {exportingPlate ? 'Exporting…' : 'Export 3MF'}
                    </Button>
                  )}
                  {plannedPlates.length > 1 && (
                    <>
                      <button
                        type="button"
                        className={buttonVariants({ variant: 'outline', size: 'icon-sm' })}
                        disabled={plateIndex === 0}
                        aria-label="Previous plate"
                        onClick={() => setPlateIndex((current) => Math.max(0, current - 1))}
                      >
                        <ChevronLeft />
                      </button>
                      <button
                        type="button"
                        className={buttonVariants({ variant: 'outline', size: 'icon-sm' })}
                        disabled={plateIndex >= plannedPlates.length - 1}
                        aria-label="Next plate"
                        onClick={() => setPlateIndex((current) => Math.min(plannedPlates.length - 1, current + 1))}
                      >
                        <ChevronRight />
                      </button>
                    </>
                  )}
                </div>
              </div>
            </CardHeader>
            <CardContent>
              {placements.length ? (
                <PlateViewer
                  printer={activePrinter}
                  placements={placements}
                  geometries={geometries}
                  invalidCopyIds={invalidCopyIds}
                  geometryRevision={geometryRevision}
                />
              ) : (
                <div className="grid h-[min(62vh,720px)] min-h-80 place-items-center rounded-xl border border-dashed text-center text-muted-foreground">
                  <div>
                    <Box className="mx-auto mb-3 size-10" />
                    <p>
                      {waitingCount
                        ? `Preparing ${waitingCount} of ${selectedOutstanding.length} models in the background.`
                        : selectedOutstanding.length
                          ? 'No analyzed models are assigned to this printer.'
                          : `No queued ${printTypeLabel(activePrinter.printType).toLowerCase()} models match these filters.`}
                    </p>
                    {waitingCount > 0 && (
                      <p className="mt-1 text-xs">
                        {storedPlanner?.queue.pending ?? 0} running · {storedPlanner?.queue.queued ?? 0} queued
                      </p>
                    )}
                  </div>
                </div>
              )}
              {error && <p className="mt-3 text-sm text-destructive">{error}</p>}
              {placements.length > 0 && waitingCount > 0 && (
                <p className="mt-3 text-sm text-muted-foreground">
                  Plate contains {readyCount} analyzed models; {waitingCount} more are being prepared in the background.
                </p>
              )}
              {plannedPlates.length > 0 && (
                <p className="mt-3 text-sm font-medium">
                  {plannedPlates.length - plateIndex} {plannedPlates.length - plateIndex === 1 ? 'plate' : 'plates'} remaining
                  {waitingCount ? ' for the analyzed backlog so far' : ' to finish the backlog'}.
                </p>
              )}
              {plannedPlates.length > 1 && (
                <div className="mt-3 flex gap-2 overflow-x-auto pb-1">
                  {plannedPlates.map((plate, index) => (
                    <button
                      type="button"
                      key={plate.map((placement) => placement.copyId).join('|')}
                      onClick={() => setPlateIndex(index)}
                      className={cn(
                        'min-w-24 rounded-md border px-3 py-2 text-left text-xs',
                        index === plateIndex ? 'border-primary bg-primary/10 text-foreground' : 'text-muted-foreground',
                      )}
                    >
                      <span className="block font-medium">Plate {index + 1}</span>
                      <span>{plate.length} models</span>
                    </button>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
        {selectedRequest && (
          <RequestModal request={selectedRequest} people={people} hideRequester={false} onClose={() => setOpenRequestId(undefined)} />
        )}
      </main>
    </div>
  )
}

async function mapConcurrent<Input, Output>(items: Input[], concurrency: number, work: (item: Input) => Promise<Output>) {
  const results = Array.from<Output>({ length: items.length })
  let nextIndex = 0
  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, async () => {
      while (nextIndex < items.length) {
        const index = nextIndex++
        results[index] = await work(items[index])
      }
    }),
  )
  return results
}

function plannerFingerprint(
  requests: { id: string; counts: Record<string, number>; printType?: 'resin' | 'filament' }[],
  printers: PrinterProfile[],
  analyses = new Map<string, import('../core/platePlanner').PlateModelAnalysis>(),
) {
  return JSON.stringify({
    analysisVersion: ORIENTATION_ANALYSIS_VERSION,
    plateLayoutVersion: PLATE_LAYOUT_VERSION,
    printers,
    requests: requests.map((request) => ({
      id: request.id,
      todo: request.counts.todo ?? 0,
      printType: request.printType,
      analysisVersion: analyses.get(request.id)?.analysisVersion,
      orientationCount: analyses.get(request.id)?.orientationCandidates?.length ?? 0,
      dimensions: analyses.get(request.id)
        ? [analyses.get(request.id)?.widthMm, analyses.get(request.id)?.depthMm, analyses.get(request.id)?.heightMm]
        : undefined,
    })),
  })
}

function selectedOrientation(analysis: import('../core/platePlanner').PlateModelAnalysis, printer: PrinterProfile): ResinOrientation {
  if (printer.printType === 'filament') {
    return {
      quaternion: [0, 0, 0, 1],
      widthMm: analysis.widthMm,
      depthMm: analysis.depthMm,
      heightMm: analysis.heightMm,
      islandCount: 0,
      islandRisk: 0,
      supportAreaMm2: 0,
      estimatedVolumeMm3: analysis.estimatedVolumeMm3 ?? 0,
      supportSpreadMm: 0,
      centerOfMassOffsetMm: 0,
      stabilityRisk: 0,
      loadPathRisk: 0,
      score: 0,
    }
  }
  return (
    analysis.orientationCandidates?.find((orientation) => orientationFitsPrinter(orientation, printer)) ??
    analysis.orientationCandidates?.[0] ?? {
      quaternion: analysis.orientationQuaternion ?? [0, 0, 0, 1],
      widthMm: analysis.widthMm,
      depthMm: analysis.depthMm,
      heightMm: analysis.heightMm,
      islandCount: analysis.orientationIslandCount ?? 0,
      islandRisk: analysis.orientationRisk ?? 0,
      supportAreaMm2: 0,
      estimatedVolumeMm3: 0,
      supportSpreadMm: 0,
      centerOfMassOffsetMm: 0,
      stabilityRisk: 0,
      loadPathRisk: 0,
      score: 0,
    }
  )
}

function orientationFitsPrinter(orientation: ResinOrientation, printer: PrinterProfile) {
  return candidateFitsPrinter(
    {
      copyId: 'fit-check',
      requestId: 'fit-check',
      name: 'Fit check',
      footprint: { widthMm: orientation.widthMm, depthMm: orientation.depthMm, known: true },
      estimatedSupportedHeightMm: orientation.heightMm + (printer.printType === 'resin' ? printer.heightAllowanceMm : 0),
    },
    printer,
  )
}

function requestPrintType(request: { printType?: 'resin' | 'filament' }) {
  return request.printType
}

function plannerDrafts(storedPlanner: unknown) {
  return (
    (
      storedPlanner as {
        drafts?: Record<string, import('../core/platePlanner').PlatePlannerDraft>
      }
    ).drafts ?? {}
  )
}

function draftPlates(draft?: import('../core/platePlanner').PlatePlannerDraft) {
  if (!draft) return []
  return draft.plates?.length ? draft.plates : draft.placements.length ? [draft.placements] : []
}

function downloadFile(bytes: Uint8Array, fileName: string, type: string) {
  const content = new Uint8Array(bytes.byteLength)
  content.set(bytes)
  const blob = new Blob([content.buffer], { type })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = fileName
  link.click()
  URL.revokeObjectURL(url)
}

function fileNamePart(value: string) {
  return (
    value
      .trim()
      .replace(/[^a-z0-9]+/gi, '-')
      .replace(/^-|-$/g, '')
      .toLowerCase() || 'build'
  )
}

function orientationJobLabel(status?: import('../core/platePlanner').OrientationAnalysisJob['status'], error?: string) {
  if (status === 'running') return 'Analyzing now…'
  if (status === 'failed') return `Analysis failed${error ? `: ${error}` : ''}`
  if (status === 'ready') return 'Analysis ready'
  return 'Queued for background analysis…'
}
