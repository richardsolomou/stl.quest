import { queryOptions } from '@tanstack/react-query'
import {
  getBoardSettings,
  getAccountMethods,
  getDiagnostics,
  getIntegrationSettings,
  getStorageSettings,
  getStorageMigration,
  getSystemDiagnostics,
  getTelemetrySettings,
  listInvites,
  listRequests,
  listPeople,
  listUsers,
  getPlatePlannerState,
  sessionInfo,
} from '../server/fns'
import type { RequestFilters } from '../core/types'

export const sessionQuery = (workspaceSlug?: string) =>
  queryOptions({ queryKey: ['session', workspaceSlug], queryFn: () => sessionInfo({ data: { workspaceSlug } }) })
export const accountMethodsQuery = () => queryOptions({ queryKey: ['account-methods'], queryFn: () => getAccountMethods() })
export const requestsQuery = (workspaceSlug: string, filters: RequestFilters = {}) =>
  queryOptions({
    queryKey: ['requests', workspaceSlug, filters],
    queryFn: () => listRequests({ data: { ...filters, workspaceSlug } }),
    placeholderData: (previousData, previousQuery) => (previousQuery?.queryKey[1] === workspaceSlug ? previousData : undefined),
  })
export const peopleQuery = (workspaceSlug: string) =>
  queryOptions({ queryKey: ['people', workspaceSlug], queryFn: () => listPeople({ data: { workspaceSlug } }) })
export const usersQuery = (workspaceSlug: string) =>
  queryOptions({ queryKey: ['users', workspaceSlug], queryFn: () => listUsers({ data: { workspaceSlug } }) })
export const invitesQuery = (workspaceSlug: string) =>
  queryOptions({ queryKey: ['invites', workspaceSlug], queryFn: () => listInvites({ data: { workspaceSlug } }) })
export const storageQuery = (workspaceSlug: string) =>
  queryOptions({ queryKey: ['storage', workspaceSlug], queryFn: () => getStorageSettings({ data: { workspaceSlug } }) })
export const storageMigrationQuery = (workspaceSlug: string) =>
  queryOptions({
    queryKey: ['storage-migration', workspaceSlug],
    queryFn: () => getStorageMigration({ data: { workspaceSlug } }),
    refetchInterval: (query) => (query.state.data?.state === 'running' ? 1_000 : false),
  })
export const telemetryQuery = () => queryOptions({ queryKey: ['telemetry'], queryFn: () => getTelemetrySettings() })
export const boardQuery = (workspaceSlug: string) =>
  queryOptions({ queryKey: ['board-settings', workspaceSlug], queryFn: () => getBoardSettings({ data: { workspaceSlug } }) })
export const diagnosticsQuery = (workspaceSlug: string) =>
  queryOptions({
    queryKey: ['diagnostics', workspaceSlug],
    queryFn: () => getDiagnostics({ data: { workspaceSlug } }),
    refetchInterval: (query) => {
      const jobs = query.state.data?.backgroundJobs ?? []
      return jobs.some((job) => job.status === 'pending' || job.status === 'running') ? 2_000 : 30_000
    },
  })
export const systemDiagnosticsQuery = () =>
  queryOptions({ queryKey: ['system-diagnostics'], queryFn: () => getSystemDiagnostics(), refetchInterval: 30_000 })
export const integrationsQuery = () => queryOptions({ queryKey: ['integrations'], queryFn: () => getIntegrationSettings() })
export const platePlannerQuery = (workspaceSlug: string) =>
  queryOptions({ queryKey: ['plate-planner', workspaceSlug], queryFn: () => getPlatePlannerState({ data: { workspaceSlug } }) })
