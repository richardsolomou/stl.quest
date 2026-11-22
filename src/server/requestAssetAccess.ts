import type { Identity, PrintRequest, Repository } from '../core/types'
import { memberSeesOnlyOwnRequests } from './app'

export type RequestAssetContext = {
  identity: Pick<Identity, 'id' | 'role'>
  repository: Repository
  service: { getRequest(requestId: string): Promise<PrintRequest | undefined> }
}

export async function authorizedRequestAsset(context: RequestAssetContext, requestId: string) {
  const request = await context.service.getRequest(requestId)
  if (!request) return undefined
  if (context.identity.role === 'admin') return request
  if (!(await memberSeesOnlyOwnRequests(context.repository, context.identity))) return request
  return request.ownerUserId === context.identity.id ? request : undefined
}

/** What a request prints as for telemetry: its assigned printer's type, else the type it asked for. */
export async function requestPrintType(repository: Pick<Repository, 'listInventory'>, request: PrintRequest) {
  const printer = request.printerId ? (await repository.listInventory('printers')).find(({ id }) => id === request.printerId) : undefined
  return printer?.printType ?? request.requestedPrintType
}
