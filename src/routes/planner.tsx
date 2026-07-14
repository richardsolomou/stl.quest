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
import { savePlatePlannerDraft } from '../server/fns'
import type { ResinOrientation } from '../core/mesh/resinOrientation'
import {
  normalizePrinterProfile,
  ORIENTATION_ANALYSIS_VERSION,
  candidateFitsPrinter,
  orientationAnalysisReady,
  planPlates,
  placementIssues,
  type PlateCandidate,
  type PlatePlacement,
  type PrinterProfile,
} from '../core/platePlanner'

export const Route = createFileRoute('/planner')({
  validateSearch: validateRequestSearch,
  beforeLoad: async ({ context }) => {
    const session = await context.queryClient.ensureQueryData(sessionQuery())
    if (session.identity?.role === 'admin' && session.printers.length === 0) throw redirect({ to: '/' })
  },
  component: PlannerPage,
})

const PLATE_LAYOUT_VERSION = 4

const DEFAULT_PRINTERS: PrinterProfile[] = [
  {
    id: 'resin-medium',
    name: 'Printer 1',
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
  const filters = filtersFromSearch(search, 'created-asc')
  const { data, isFetching } = useQuery(requestsQuery(filters))
  const { data: allData } = useQuery(requestsQuery({ sort: 'created-asc' }))
  const { data: people = [] } = useQuery(peopleQuery())
  const { data: storedPlanner } = useQuery(platePlannerQuery())
  const [printers, setPrinters] = useState(DEFAULT_PRINTERS)
  const [printerId, setPrinterId] = useState(DEFAULT_PRINTERS[0].id)
  const [geometries] = useState(() => new Map<string, THREE.BufferGeometry>())
  const [plates, setPlates] = useState<PlatePlacement[][]>([])
  const [plateIndex, setPlateIndex] = useState(0)
  const [geometryRevision, setGeometryRevision] = useState(0)
  const [error, setError] = useState<string>()
  const [exportingPlate, setExportingPlate] = useState(false)
  const [restored, setRestored] = useState(false)
  const [openRequestId, setOpenRequestId] = useState<string>()
  const generationRef = useRef(0)
  const generatedFingerprintRef = useRef<string | undefined>(undefined)

  const printer = printers.find((profile) => profile.id === printerId) ?? printers[0]
  const placements = useMemo(() => plates[plateIndex] ?? [], [plateIndex, plates])
  const outstanding = useMemo(
    () =>
      (data?.requests ?? []).filter(
        (request) => (request.counts.todo ?? 0) > 0 && (!request.printerId || request.printerId === printer.id),
      ),
    [data?.requests, printer.id],
  )
  const allOutstanding = useMemo(() => (allData?.requests ?? []).filter((request) => (request.counts.todo ?? 0) > 0), [allData?.requests])
  const issues = useMemo(() => placementIssues(placements, printer), [placements, printer])
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
  const readyCount = outstanding.filter((request) => {
    const analysis = analyses.get(request.id)
    return orientationAnalysisReady(analysis)
  }).length
  const waitingCount = outstanding.length - readyCount
  const unfitRequests = useMemo(
    () =>
      allOutstanding.filter((request) => {
        const analysis = analyses.get(request.id)
        return orientationAnalysisReady(analysis) && !printers.some((profile) => analysisFitsPrinter(analysis, profile))
      }),
    [allOutstanding, analyses, printers],
  )
  const fingerprint = useMemo(() => plannerFingerprint(outstanding, printer, analyses), [analyses, outstanding, printer])

  useEffect(() => {
    preloadStlViewer()
  }, [])

  useEffect(() => {
    if (!storedPlanner || restored) return
    const profiles = storedPlanner.profiles?.length
      ? storedPlanner.profiles.map((profile) => normalizePrinterProfile(profile))
      : DEFAULT_PRINTERS
    const savedPrinterId = storedPlanner.draft?.printerId
    const selectedPrinter = profiles.find((profile) => profile.id === savedPrinterId) ?? profiles[0]
    setPrinters(profiles)
    setPrinterId(selectedPrinter.id)
    const storedAnalyses = new Map(storedPlanner.analyses.map((analysis) => [analysis.requestId, analysis]))
    if (storedPlanner.draft?.fingerprint === plannerFingerprint(outstanding, selectedPrinter, storedAnalyses)) {
      setPlates(storedPlanner.draft.plates?.length ? storedPlanner.draft.plates : [storedPlanner.draft.placements])
    }
    setRestored(true)
  }, [outstanding, restored, storedPlanner])

  const generate = useCallback(async () => {
    const generation = ++generationRef.current
    setError(undefined)
    try {
      const analyzed: PlateCandidate[] = []
      for (const request of outstanding) {
        const analysis = analyses.get(request.id)
        if (!orientationAnalysisReady(analysis)) continue
        const orientation = selectedOrientation(analysis, printer)
        const copyCount = request.counts.todo ?? 0
        for (let copy = 1; copy <= copyCount; copy++) {
          analyzed.push({
            copyId: `${request.id}:${copy}`,
            requestId: request.id,
            name: `${request.name} #${copy}`,
            footprint: { widthMm: orientation.widthMm, depthMm: orientation.depthMm, known: true },
            estimatedSupportedHeightMm: orientation.heightMm + printer.heightAllowanceMm,
            orientationQuaternion: orientation.quaternion,
            orientationIslandCount: orientation.islandCount,
            orientationRisk: orientation.islandRisk,
          })
        }
      }
      const result = planPlates(analyzed, printer)
      if (generation !== generationRef.current) return
      setPlates(result.plates)
      setPlateIndex((current) => Math.min(current, Math.max(0, result.plates.length - 1)))
      generatedFingerprintRef.current = fingerprint
      await savePlatePlannerDraft({
        data: {
          draft: {
            fingerprint,
            printerId: printer.id,
            candidates: analyzed,
            placements: result.plates[0] ?? [],
            plates: result.plates,
            skippedCount: result.skipped.length,
            savedAt: Date.now(),
          },
        },
      })
    } catch (cause) {
      if (generation === generationRef.current) setError(cause instanceof Error ? cause.message : 'Could not generate a plate')
    } finally {
      // Generation only packs cached server analyses; background workers own STL analysis.
    }
  }, [analyses, fingerprint, outstanding, printer])

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
      downloadFile(archive, `${fileNamePart(printer.name)}-plate-${exportingIndex + 1}.3mf`, 'model/3mf')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not export this plate')
    } finally {
      setExportingPlate(false)
    }
  }, [allData?.requests, exportingPlate, placements, plateIndex, printer.name])

  useEffect(() => {
    if (!restored || !storedPlanner || generatedFingerprintRef.current === fingerprint) return
    if (!outstanding.length) {
      generationRef.current++
      generatedFingerprintRef.current = fingerprint
      setPlates([])
      setPlateIndex(0)
      return
    }
    setPlates([])
    setPlateIndex(0)
    void generate()
  }, [fingerprint, generate, outstanding.length, restored, storedPlanner])

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
  }, [geometries, placements])

  if (!session.identity) {
    return <main className="grid min-h-dvh place-items-center p-6">Sign in from the board to use the planner.</main>
  }
  if (session.identity.role !== 'admin') {
    return <main className="grid min-h-dvh place-items-center p-6">The plate planner is admin-only.</main>
  }

  return (
    <div className="min-h-dvh max-w-full overflow-x-hidden bg-muted/20">
      <AppHeader active="planner" isAdmin />
      <main className="mx-auto w-full max-w-[1500px] min-w-0 p-3 sm:p-4 md:p-6">
        <BoardFilters
          search={search}
          facets={data?.facets ?? { requesters: [], total: 0, available: 0 }}
          isFetching={isFetching}
          defaultSort="created-asc"
          ariaLabel="Planner filters"
          description="Only matching queued copies are included when PrintHub generates build plates."
          className="mb-4 rounded-xl border bg-card px-3 pb-2.5"
          onChange={(patch, replace = false) => void navigate({ to: '/planner', search: updateRequestSearch(search, patch), replace })}
        />
        {unfitRequests.length > 0 && (
          <Alert className="mb-4 border-amber-500/40 bg-amber-500/5">
            <TriangleAlert />
            <AlertTitle>
              {unfitRequests.length} queued {unfitRequests.length === 1 ? 'model does' : 'models do'} not fit any configured printer
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
                <div className="space-y-2">
                  <label htmlFor="printer-profile" className="text-sm font-medium">
                    Profile
                  </label>
                  <Select
                    items={printers.map((profile) => ({ value: profile.id, label: profile.name }))}
                    value={printerId}
                    onValueChange={(value) => {
                      if (!value || value === printerId) return
                      generationRef.current++
                      generatedFingerprintRef.current = undefined
                      setPlates([])
                      setPlateIndex(0)
                      setPrinterId(value)
                    }}
                  >
                    <SelectTrigger id="printer-profile" className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {printers.map((profile) => (
                        <SelectItem key={profile.id} value={profile.id}>
                          {profile.name}
                        </SelectItem>
                      ))}
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
                      people={people}
                      status="todo"
                      count={content.count}
                      canDrag={false}
                      settling={false}
                      hideRequester={false}
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
                  {outstanding
                    .filter((request) => !orientationAnalysisReady(analyses.get(request.id)))
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
                <CardTitle>{plates.length ? `Build plate ${plateIndex + 1} of ${plates.length}` : 'Build plate'}</CardTitle>
                <div className="flex items-center gap-1">
                  {placements.length > 0 && (
                    <Button type="button" variant="outline" size="sm" disabled={exportingPlate} onClick={() => void downloadPlate()}>
                      {exportingPlate ? <Spinner /> : <Download />}
                      {exportingPlate ? 'Exporting…' : 'Export 3MF'}
                    </Button>
                  )}
                  {plates.length > 1 && (
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
                        disabled={plateIndex >= plates.length - 1}
                        aria-label="Next plate"
                        onClick={() => setPlateIndex((current) => Math.min(plates.length - 1, current + 1))}
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
                  printer={printer}
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
                        ? `Preparing ${waitingCount} of ${outstanding.length} models in the background.`
                        : outstanding.length
                          ? 'No analyzed models fit this build plate.'
                          : 'No queued models match these filters.'}
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
              {plates.length > 0 && (
                <p className="mt-3 text-sm font-medium">
                  {plates.length - plateIndex} {plates.length - plateIndex === 1 ? 'plate' : 'plates'} remaining
                  {waitingCount ? ' for the analyzed backlog so far' : ' to finish the backlog'}.
                </p>
              )}
              {plates.length > 1 && (
                <div className="mt-3 flex gap-2 overflow-x-auto pb-1">
                  {plates.map((plate, index) => (
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
          <RequestModal
            request={selectedRequest}
            workflow={session.workflow}
            isAdmin
            hideRequester={false}
            onClose={() => setOpenRequestId(undefined)}
          />
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
  requests: { id: string; counts: Record<string, number> }[],
  printer: PrinterProfile,
  analyses = new Map<string, import('../core/platePlanner').PlateModelAnalysis>(),
) {
  return JSON.stringify({
    resinOrientationVersion: ORIENTATION_ANALYSIS_VERSION,
    plateLayoutVersion: PLATE_LAYOUT_VERSION,
    printer,
    requests: requests.map((request) => ({
      id: request.id,
      todo: request.counts.todo ?? 0,
      analysisVersion: analyses.get(request.id)?.analysisVersion,
      orientationCount: analyses.get(request.id)?.orientationCandidates?.length ?? 0,
    })),
  })
}

function selectedOrientation(analysis: import('../core/platePlanner').PlateModelAnalysis, printer: PrinterProfile): ResinOrientation {
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

function analysisFitsPrinter(
  analysis: import('../core/platePlanner').PlateModelAnalysis & { orientationCandidates: ResinOrientation[] },
  printer: PrinterProfile,
) {
  return analysis.orientationCandidates.some((orientation) => orientationFitsPrinter(orientation, printer))
}

function orientationFitsPrinter(orientation: ResinOrientation, printer: PrinterProfile) {
  return candidateFitsPrinter(
    {
      copyId: 'fit-check',
      requestId: 'fit-check',
      name: 'Fit check',
      footprint: { widthMm: orientation.widthMm, depthMm: orientation.depthMm, known: true },
      estimatedSupportedHeightMm: orientation.heightMm + printer.heightAllowanceMm,
    },
    printer,
  )
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
