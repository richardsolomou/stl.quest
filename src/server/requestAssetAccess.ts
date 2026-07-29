import type { Identity, PrintRequest, Repository } from '../core/types'
import { resolveBoardConfig } from './app'

export type RequestAssetContext = {
  identity: Pick<Identity, 'id' | 'role'>
  repository: Repository
  service: { getRequest(requestId: string): Promise<PrintRequest | undefined> }
}

export async function authorizedRequestAsset(context: RequestAssetContext, requestId: string) {
  const request = await context.service.getRequest(requestId)
  if (!request) return undefined
  if (context.identity.role === 'admin') return request
  if (!(await resolveBoardConfig(context.repository)).privateRequests) return request
  return request.ownerUserId === context.identity.id ? request : undefined
}
