import type { PriceCalculatorCurrency } from '../../core/priceCalculator'
import type { AssetGenerationJob, Invite, OperationPayload, PrintRequest } from '../../core/types'
import type { Plate } from '../../core/plates'
import type { PrintJob, PrintSpoolUsage } from '../../core/printJobs'
import type { UsageEvent } from '../../core/usage'
import { assetGenerationJobs, invites, plateItems, plates, printJobs, requests, requestStatuses, usageEvents, user } from '../schema'

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
    failureKind: job.failureKind ?? undefined,
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

export function mapUsageEvent(row: typeof usageEvents.$inferSelect): UsageEvent {
  return {
    id: row.id,
    transactionId: row.transactionId,
    stage: row.stage,
    kind: row.kind,
    requestId: row.requestId ?? undefined,
    printerId: row.printerId ?? undefined,
    equipmentId: row.equipmentId ?? undefined,
    consumableId: row.consumableId ?? undefined,
    amount: row.amount,
    unit: row.unit,
    copies: row.copies ?? undefined,
    outcome: row.outcome ?? undefined,
    unitPrice: row.unitPrice ?? undefined,
    currency: (row.currency as PriceCalculatorCurrency | null) ?? undefined,
    userId: row.userId ?? undefined,
    createdAt: row.createdAt,
    undoneAt: row.undoneAt ?? undefined,
    ...(row.estimated && { estimated: true }),
    ...(row.plateId && { plateId: row.plateId }),
    ...(row.supersededBy && { supersededBy: row.supersededBy }),
    ...(row.deletedItemName !== null && { deletedItemName: row.deletedItemName }),
    ...(row.deletedItemKind && { deletedItemKind: row.deletedItemKind }),
  }
}

export function mapPlate(row: typeof plates.$inferSelect, items: (typeof plateItems.$inferSelect)[]): Plate {
  const { transactionId, source, method, unit, minutes, recordedAt } = row
  return {
    id: row.id,
    number: row.number,
    ...(row.printerId && { printerId: row.printerId }),
    otherStuff: row.otherStuff,
    items: items.map((item) => ({
      requestId: item.requestId,
      copies: item.copies,
      ...(item.amount !== null && { amount: item.amount }),
      ...(item.minutes !== null && { minutes: item.minutes }),
    })),
    ...(transactionId &&
      source &&
      method &&
      unit &&
      minutes !== null &&
      recordedAt !== null && {
        recording: {
          transactionId,
          source,
          method,
          unit,
          minutes,
          otherAmount: row.otherAmount ?? 0,
          overheadAmount: row.overheadAmount ?? 0,
          recordedAt,
        },
      }),
    ...(row.statusId && { stage: row.statusId }),
    ...(row.startedAt !== null && { startedAt: row.startedAt }),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }
}

export function mapPrintJob(row: typeof printJobs.$inferSelect): PrintJob {
  const optional = <Key extends keyof typeof row>(key: Key) =>
    (row[key] === null ? {} : { [key]: row[key] }) as Partial<Record<Key, NonNullable<(typeof row)[Key]>>>
  return {
    id: row.id,
    printerName: row.printerName,
    outcome: row.outcome,
    personal: row.personal,
    receivedAt: row.receivedAt,
    ...optional('printerId'),
    ...optional('fileName'),
    ...optional('minutes'),
    ...optional('grams'),
    ...optional('filamentDetails'),
    ...(row.filamentUsage !== null && { filamentUsage: JSON.parse(row.filamentUsage) as PrintSpoolUsage[] }),
    ...(row.slicedPlate !== null && { slicedPlate: JSON.parse(row.slicedPlate) as NonNullable<PrintJob['slicedPlate']> }),
    ...optional('reason'),
    ...optional('progress'),
    ...optional('archiveId'),
    ...optional('runId'),
    ...optional('plateId'),
    ...optional('transactionId'),
    ...optional('startedAt'),
    ...optional('endedAt'),
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
    number: row.number ?? 0,
    name: row.name,
    fileName: row.fileName ?? undefined,
    filePath: row.filePath ?? undefined,
    quantity: row.quantity,
    ownerUserId: row.ownerUserId,
    ownerEmail: row.ownerEmail,
    ownerName: row.ownerName,
    notes: row.notes ?? undefined,
    sourceUrl: row.sourceUrl ?? undefined,
    sourceImageUrl: row.sourceImageUrl ?? undefined,
    sourceImagePath: row.sourceImagePath ?? undefined,
    thumbnailPath: row.thumbnailPath ?? undefined,
    previewPath: row.previewPath ?? undefined,
    requestedPrintType: row.printType ?? undefined,
    printerId: row.printerId ?? undefined,
    automaticPrinterAssignment: row.automaticPrinterAssignment,
    modelDimensions:
      row.modelWidthMm !== null && row.modelDepthMm !== null && row.modelHeightMm !== null
        ? { widthMm: row.modelWidthMm, depthMm: row.modelDepthMm, heightMm: row.modelHeightMm }
        : undefined,
    modelVolumeMm3: row.modelVolumeMm3 ?? undefined,
    modelSurfaceAreaMm2: row.modelSurfaceAreaMm2 ?? undefined,
    estimatedMaterialOverride: row.estimatedMaterialOverride ?? undefined,
    estimatedPrintMinutesOverride: row.estimatedPrintMinutesOverride ?? undefined,
    hasThumbnail: row.thumbnailPath !== null,
    archivedAt: row.archivedAt ?? undefined,
    unarchivedAt: row.unarchivedAt ?? undefined,
    ...(row.chargedAmount !== null &&
      row.chargedCurrency !== null && {
        charged: { amount: row.chargedAmount, currency: row.chargedCurrency as PriceCalculatorCurrency },
      }),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    counts: Object.fromEntries(states.map((state) => [state.statusId, state.quantity])),
    orders: Object.fromEntries(states.map((state) => [state.statusId, state.sortOrder ?? undefined])),
    completedAt: states.find((state) => state.statusId === 'done')?.completedAt ?? undefined,
  }
}
