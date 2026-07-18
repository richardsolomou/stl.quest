import type { AssetGenerationJob, PrintRequest } from '../../core/types'
import type { PlateModelAnalysis } from '../../core/platePlanner'
import { assetGenerationJobs, plateModelAnalysis, requests, requestStatuses } from '../schema'

export type RequestRow = typeof requests.$inferSelect & {
  ownerEmail: string
  ownerName: string
  estimatedVolumeMm3: number | null
}

type RequestStatusRow = typeof requestStatuses.$inferSelect

export function mapAssetGenerationJob(job: typeof assetGenerationJobs.$inferSelect): AssetGenerationJob {
  return {
    requestId: job.requestId,
    stage: job.stage,
    status: job.status,
    error: job.error ?? undefined,
    queuedAt: job.queuedAt,
    startedAt: job.startedAt ?? undefined,
    finishedAt: job.finishedAt ?? undefined,
  }
}

export function mapPlateModelAnalysis(analysis: typeof plateModelAnalysis.$inferSelect): PlateModelAnalysis {
  return {
    requestId: analysis.requestId,
    widthMm: analysis.widthMm,
    depthMm: analysis.depthMm,
    heightMm: analysis.heightMm,
    orientationQuaternion: analysis.orientationQuaternion
      ? (JSON.parse(analysis.orientationQuaternion) as [number, number, number, number])
      : undefined,
    orientationIslandCount: analysis.orientationIslandCount ?? undefined,
    orientationRisk: analysis.orientationRisk ?? undefined,
    orientationCandidates: analysis.orientationCandidates
      ? (JSON.parse(analysis.orientationCandidates) as import('../../core/mesh/resinOrientation').ResinOrientation[])
      : undefined,
    contentHash: analysis.contentHash ?? undefined,
    analysisVersion: analysis.analysisVersion,
    estimatedVolumeMm3: analysis.estimatedVolumeMm3 ?? undefined,
  }
}

export function mapRequest(row: RequestRow, states: RequestStatusRow[]): PrintRequest {
  return {
    id: row.id,
    name: row.name,
    fileName: row.fileName,
    filePath: row.filePath,
    quantity: row.quantity,
    ownerUserId: row.ownerUserId,
    ownerEmail: row.ownerEmail,
    ownerName: row.ownerName,
    notes: row.notes ?? undefined,
    sourceUrl: row.sourceUrl ?? undefined,
    thumbnailPath: row.thumbnailPath ?? undefined,
    previewPath: row.previewPath ?? undefined,
    requestedPrintType: row.printType ?? undefined,
    printerId: row.printerId ?? undefined,
    hasThumbnail: row.thumbnailPath !== null,
    estimatedVolumeMm3: row.estimatedVolumeMm3 ?? undefined,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    counts: Object.fromEntries(states.map((state) => [state.statusId, state.quantity])),
    orders: Object.fromEntries(states.map((state) => [state.statusId, state.sortOrder ?? undefined])),
  }
}
