import type { AssetGenerationJob, PrintRequest } from '../../core/types'
import { assetGenerationJobs, requests, requestStatuses } from '../schema'

export type RequestRow = typeof requests.$inferSelect & {
  ownerEmail: string
  ownerImage: string | null
  ownerName: string
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

export function mapRequest(row: RequestRow, states: RequestStatusRow[]): PrintRequest {
  return {
    id: row.id,
    name: row.name,
    fileName: row.fileName,
    filePath: row.filePath,
    quantity: row.quantity,
    ownerUserId: row.ownerUserId,
    ownerEmail: row.ownerEmail,
    ownerImage: row.ownerImage ?? undefined,
    ownerName: row.ownerName,
    notes: row.notes ?? undefined,
    sourceUrl: row.sourceUrl ?? undefined,
    thumbnailPath: row.thumbnailPath ?? undefined,
    previewPath: row.previewPath ?? undefined,
    requestedPrintType: row.printType ?? undefined,
    printerId: row.printerId ?? undefined,
    automaticPrinterAssignment: row.automaticPrinterAssignment,
    modelDimensions:
      row.modelWidthMm !== null && row.modelDepthMm !== null && row.modelHeightMm !== null
        ? { widthMm: row.modelWidthMm, depthMm: row.modelDepthMm, heightMm: row.modelHeightMm }
        : undefined,
    hasThumbnail: row.thumbnailPath !== null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    counts: Object.fromEntries(states.map((state) => [state.statusId, state.quantity])),
    orders: Object.fromEntries(states.map((state) => [state.statusId, state.sortOrder ?? undefined])),
    completedAt: states.find((state) => state.statusId === 'done')?.completedAt ?? undefined,
  }
}
