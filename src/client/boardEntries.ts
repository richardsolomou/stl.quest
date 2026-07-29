import type { PrintGroup, PublicPrintRequest } from '../core/types'
import type { StatusId, WorkflowDefinition } from '../core/workflow'

export type BoardStatusEntries = {
  entries: Array<{ request: PublicPrintRequest; count: number }>
  total: number
}

export function boardEntriesByStatus(
  requests: PublicPrintRequest[],
  groups: PrintGroup[],
  statuses: readonly WorkflowDefinition['statuses'][number][],
  countsOf: (request: PublicPrintRequest) => PublicPrintRequest['counts'],
  compare: (left: PublicPrintRequest, right: PublicPrintRequest, status: StatusId) => number,
) {
  return new Map(
    statuses.map((definition) => {
      const status = definition.id
      const entries = requests
        .map((request) => ({
          request,
          count:
            countsOf(request)[status] -
            request.groups.filter((group) => group.status === status).reduce((sum, group) => sum + group.count, 0),
        }))
        .filter(({ count }) => count > 0)
        .sort((left, right) => compare(left.request, right.request, status))
      const groupedCopies = groups
        .filter((group) => group.status === status)
        .flatMap((group) => group.items)
        .reduce((sum, item) => sum + item.count, 0)
      return [status, { entries, total: entries.reduce((sum, entry) => sum + entry.count, groupedCopies) }] as const
    }),
  )
}
