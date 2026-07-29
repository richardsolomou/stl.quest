import type { AssetGenerationJob, Invite, OperationPayload, PrintRequest } from '../../core/types'
import { assetGenerationJobs, invites, requests, requestStatuses, user } from '../schema'

export type RequestRow = typeof requests.$inferSelect & {
  ownerEmail: string
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

export function mapInvite(row: typeof invites.$inferSelect): Invite {
  return {
    id: row.id,
    role: row.role,
    label: row.label ?? undefined,
    recipientEmail: row.recipientEmail ?? undefined,
    createdAt: row.createdAt,
    expiresAt: row.expiresAt,
    usedAt: row.usedAt ?? undefined,
  }
}

export function parseOperationPayload(value: string) {
  return JSON.parse(value) as OperationPayload
}

export function mapUserIdentity(row: Pick<typeof user.$inferSelect, 'id' | 'email' | 'name' | 'image'>) {
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    image: row.image ?? undefined,
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
