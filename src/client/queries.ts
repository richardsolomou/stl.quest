import { queryOptions, type QueryClient } from '@tanstack/react-query'
import {
  getBoardSettings,
  getPriceCalculatorSettings,
  getConsumables,
  getEquipment,
  getInventoryReferences,
  getAuthCapabilities,
  getAccountMethods,
  getAdminAccount,
  getAdminWorkspace,
  getPlanOverview,
  getDiagnostics,
  getEmailBranding,
  getIntegrationSettings,
  getStorageSettings,
  getStorageMigration,
  getSystemDiagnostics,
  getCloudConnections,
  getTelemetrySettings,
  listInvites,
  listAccounts,
  listAdminWorkspaces,
  listRequests,
  listPeople,
  listUsers,
  getPrinters,
  getReleaseUpdate,
  getOnboardingProgress,
  getNotificationPreferences,
  sessionInfo,
  listUsage,
  getStockLevels,
  getPrinterLifetimes,
  getUsagePrefills,
  getUsageBackfillPreview,
  getChargedPrints,
  getPlates,
} from '../server/fns'
import type { ElectricityPricePreset } from '../core/electricityPresets'
import type { InventoryKind } from '../core/inventory'
import type { FilamentPreset } from '../core/filamentPresets'
import type { PartPreset } from '../core/partPresets'
import { estimatePending } from '../core/printEstimates'
import type { ResinPreset } from '../core/resinPresets'
import type { SupplyPreset } from '../core/supplyPresets'
import type { PublicRequestQueryResult, RequestFilters } from '../core/types'
import { MAX_USAGE_LIST, type UsageEvent, type UsageFilters } from '../core/usage'
import type { SettingsSection } from './settingsSections'

export type RequestQuerySnapshot = [readonly unknown[], PublicRequestQueryResult | undefined]

export async function removeRequestFromQueries(queryClient: QueryClient, workspaceSlug: string, requestId: string) {
  const queryKey = ['requests', workspaceSlug]
  await queryClient.cancelQueries({ queryKey })
  const snapshots = queryClient.getQueriesData<PublicRequestQueryResult>({ queryKey })
  queryClient.setQueriesData<PublicRequestQueryResult>({ queryKey }, (result) => {
    if (!result) return result
    return {
      ...result,
      requests: result.requests.filter((request) => request.id !== requestId),
      groups: result.groups.map((group) => ({ ...group, items: group.items.filter((item) => item.requestId !== requestId) })),
    }
  })
  return snapshots
}

export function restoreRequestQueries(queryClient: QueryClient, snapshots: RequestQuerySnapshot[]) {
  for (const [queryKey, result] of snapshots) queryClient.setQueryData(queryKey, result)
}

export const sessionQuery = (workspaceSlug?: string) =>
  queryOptions({ queryKey: ['session', workspaceSlug], queryFn: () => sessionInfo({ data: { workspaceSlug } }) })

export async function preloadSessionQueries(queryClient: QueryClient) {
  const session = await queryClient.ensureQueryData(sessionQuery())
  if (session.identity?.workspaceSlug) queryClient.setQueryData(sessionQuery(session.identity.workspaceSlug).queryKey, session)
  return session
}

export const accountMethodsQuery = () => queryOptions({ queryKey: ['account-methods'], queryFn: () => getAccountMethods() })

export const authCapabilitiesQuery = () => queryOptions({ queryKey: ['auth-capabilities'], queryFn: () => getAuthCapabilities() })

export const planOverviewQuery = () => queryOptions({ queryKey: ['plan-overview'], queryFn: () => getPlanOverview() })
export const requestsQuery = (workspaceSlug: string, filters: RequestFilters = {}) =>
  queryOptions({
    queryKey: ['requests', workspaceSlug, filters],
    queryFn: () => listRequests({ data: { ...filters, workspaceSlug } }),
    placeholderData: (previousData, previousQuery) => (previousQuery?.queryKey[1] === workspaceSlug ? previousData : undefined),
  })
// Realtime normally reports the finished estimate, but a proxy that drops the WebSocket would leave the board's cards pending for good.
export const pendingEstimateRefetchInterval = (query: { state: { data?: PublicRequestQueryResult } }) =>
  query.state.data?.requests.some(estimatePending) ? 5_000 : false
export const peopleQuery = (workspaceSlug: string) =>
  queryOptions({ queryKey: ['people', workspaceSlug], queryFn: () => listPeople({ data: { workspaceSlug } }) })
export const usersQuery = (workspaceSlug: string) =>
  queryOptions({ queryKey: ['users', workspaceSlug], queryFn: () => listUsers({ data: { workspaceSlug } }) })
export const accountsQuery = () => queryOptions({ queryKey: ['accounts'], queryFn: () => listAccounts() })
export const adminWorkspacesQuery = () => queryOptions({ queryKey: ['admin-workspaces'], queryFn: () => listAdminWorkspaces() })
export const adminWorkspaceQuery = (id: string) =>
  queryOptions({ queryKey: ['admin-workspace', id], queryFn: () => getAdminWorkspace({ data: { id } }) })
export const adminAccountQuery = (id: string) =>
  queryOptions({ queryKey: ['admin-account', id], queryFn: () => getAdminAccount({ data: { id } }) })
export const releaseUpdateQuery = (enabled: boolean) =>
  queryOptions({
    queryKey: ['release-update'],
    queryFn: () => getReleaseUpdate(),
    enabled,
    retry: false,
    staleTime: 12 * 60 * 60 * 1000,
  })
export const invitesQuery = (workspaceSlug: string) =>
  queryOptions({ queryKey: ['invites', workspaceSlug], queryFn: () => listInvites({ data: { workspaceSlug } }) })
export const storageQuery = (workspaceSlug: string) =>
  queryOptions({ queryKey: ['storage', workspaceSlug], queryFn: () => getStorageSettings({ data: { workspaceSlug } }) })
export const cloudConnectionsQuery = (workspaceSlug: string) =>
  queryOptions({ queryKey: ['cloud-connections', workspaceSlug], queryFn: () => getCloudConnections({ data: { workspaceSlug } }) })
export const storageMigrationQuery = (workspaceSlug: string) =>
  queryOptions({
    queryKey: ['storage-migration', workspaceSlug],
    queryFn: () => getStorageMigration({ data: { workspaceSlug } }),
    refetchInterval: (query) => (query.state.data?.state === 'running' ? 1_000 : false),
  })
export const telemetryQuery = () => queryOptions({ queryKey: ['telemetry'], queryFn: () => getTelemetrySettings() })
export const onboardingQuery = (workspaceSlug: string) =>
  queryOptions({ queryKey: ['onboarding', workspaceSlug], queryFn: () => getOnboardingProgress() })
export const notificationPreferencesQuery = (workspaceSlug: string) =>
  queryOptions({
    queryKey: ['notification-preferences', workspaceSlug],
    queryFn: () => getNotificationPreferences({ data: { workspaceSlug } }),
  })
export const emailBrandingQuery = (workspaceSlug: string) =>
  queryOptions({ queryKey: ['email-branding', workspaceSlug], queryFn: () => getEmailBranding({ data: { workspaceSlug } }) })
export const boardQuery = (workspaceSlug: string) =>
  queryOptions({ queryKey: ['board-settings', workspaceSlug], queryFn: () => getBoardSettings({ data: { workspaceSlug } }) })
export const consumablesQuery = (workspaceSlug: string) =>
  queryOptions({ queryKey: ['consumables', workspaceSlug], queryFn: () => getConsumables({ data: { workspaceSlug } }) })
export const equipmentQuery = (workspaceSlug: string) =>
  queryOptions({ queryKey: ['equipment', workspaceSlug], queryFn: () => getEquipment({ data: { workspaceSlug } }) })
export const inventoryReferencesQuery = (workspaceSlug: string, inventory: InventoryKind, id: string) =>
  queryOptions({
    queryKey: ['inventoryReferences', workspaceSlug, inventory, id],
    queryFn: () => getInventoryReferences({ data: { workspaceSlug, inventory, id } }),
  })
export const usageQuery = (workspaceSlug: string, filters: UsageFilters = {}) =>
  queryOptions({ queryKey: ['usage', workspaceSlug, filters], queryFn: () => listUsage({ data: { ...filters, workspaceSlug } }) })
/** Every live event in a period, read a page at a time because one list is capped; a page overlaps the last by its oldest moment. */
export const usagePeriodQuery = (workspaceSlug: string, period: { from: number; to: number }) =>
  queryOptions({
    queryKey: ['usage', workspaceSlug, 'period', period],
    queryFn: async () => {
      const events = new Map<string, UsageEvent>()
      for (let to = period.to; ;) {
        const page = (await listUsage({ data: { workspaceSlug, from: period.from, to } })).events
        const before = events.size
        for (const event of page) events.set(event.id, event)
        const oldest = page.at(-1)
        if (page.length < MAX_USAGE_LIST || !oldest || events.size === before) return { events: [...events.values()] }
        to = oldest.createdAt + 1
      }
    },
    placeholderData: (previousData, previousQuery) => (previousQuery?.queryKey[1] === workspaceSlug ? previousData : undefined),
  })
export const stockQuery = (workspaceSlug: string) =>
  queryOptions({ queryKey: ['stock', workspaceSlug], queryFn: () => getStockLevels({ data: { workspaceSlug } }) })
export const printerLifetimesQuery = (workspaceSlug: string) =>
  queryOptions({ queryKey: ['printer-lifetimes', workspaceSlug], queryFn: () => getPrinterLifetimes({ data: { workspaceSlug } }) })
export const usagePrefillsQuery = (workspaceSlug: string) =>
  queryOptions({ queryKey: ['usage-prefills', workspaceSlug], queryFn: () => getUsagePrefills({ data: { workspaceSlug } }) })
export const platesQuery = (workspaceSlug: string) =>
  queryOptions({ queryKey: ['plates', workspaceSlug], queryFn: () => getPlates({ data: { workspaceSlug } }) })
export type PlateView = Awaited<ReturnType<typeof getPlates>>['plates'][number]
export const chargedPrintsQuery = (workspaceSlug: string) =>
  queryOptions({ queryKey: ['usage', workspaceSlug, 'charged'], queryFn: () => getChargedPrints({ data: { workspaceSlug } }) })
export const usageBackfillQuery = (workspaceSlug: string) =>
  queryOptions({ queryKey: ['usage-backfill', workspaceSlug], queryFn: () => getUsageBackfillPreview({ data: { workspaceSlug } }) })

export const priceCalculatorSettingsQuery = (workspaceSlug: string) =>
  queryOptions({
    queryKey: ['price-calculator-settings', workspaceSlug],
    queryFn: () => getPriceCalculatorSettings({ data: { workspaceSlug } }),
  })
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
type Catalogues = {
  electricity: ElectricityPricePreset[]
  filaments: FilamentPreset[]
  parts: PartPreset[]
  resins: ResinPreset[]
  supplies: SupplyPreset[]
}
/** Gives each preset the product photo its catalogue's `images.json` records for it. */
function withImages<Preset extends { id: string }>(presets: Preset[], images: { presetId: string; src: string }[]) {
  const sources = new Map(images.map(({ presetId, src }) => [presetId, src]))
  return presets.map((preset) => {
    const src = sources.get(preset.id)
    return src ? { ...preset, image: { src } } : preset
  })
}
// Each catalogue is its own chunk, fetched the first time something shows it, so pages that never do stay small.
const catalogues: { [Name in keyof Catalogues]: () => Promise<Catalogues[Name]> } = {
  electricity: () => import('../../catalogs/electricity/catalog.generated.json').then(({ default: catalogue }) => catalogue.presets),
  filaments: () =>
    import('../../catalogs/filaments/catalog.generated.json').then(({ default: catalogue }) => catalogue.presets as FilamentPreset[]),
  parts: () =>
    Promise.all([import('../../catalogs/parts/catalog.json'), import('../../catalogs/parts/images.json')]).then(
      ([{ default: catalogue }, { default: images }]) => withImages(catalogue.presets as PartPreset[], images.images),
    ),
  resins: () =>
    Promise.all([import('../../catalogs/resins/catalog.generated.json'), import('../../catalogs/resins/images.json')]).then(
      ([{ default: catalogue }, { default: images }]) => withImages(catalogue.presets as ResinPreset[], images.images),
    ),
  supplies: () =>
    Promise.all([import('../../catalogs/supplies/catalog.json'), import('../../catalogs/supplies/images.json')]).then(
      ([{ default: catalogue }, { default: images }]) => withImages(catalogue.presets as SupplyPreset[], images.images),
    ),
}
export const catalogueQuery = <Name extends keyof Catalogues>(name: Name) =>
  queryOptions({ queryKey: ['catalogue', name], queryFn: (): Promise<Catalogues[Name]> => catalogues[name](), staleTime: Infinity })
export const printersQuery = (workspaceSlug: string) =>
  queryOptions({ queryKey: ['printers', workspaceSlug], queryFn: () => getPrinters({ data: { workspaceSlug } }) })

/** Loads the workspace data a settings section opens with, so a direct visit renders it on the server instead of fetching after hydration. */
function prefetchSettingsSection(queryClient: QueryClient, section: SettingsSection, workspaceSlug: string, usageTracking: boolean) {
  const prefetch = queryClient.prefetchQuery.bind(queryClient)
  switch (section) {
    case 'board':
      return [prefetch(boardQuery(workspaceSlug))]
    case 'printers':
      return [prefetch(printersQuery(workspaceSlug)), prefetch(priceCalculatorSettingsQuery(workspaceSlug))]
    case 'equipment':
      return [prefetch(equipmentQuery(workspaceSlug)), prefetch(consumablesQuery(workspaceSlug))]
    case 'consumables':
      return [
        prefetch(consumablesQuery(workspaceSlug)),
        prefetch(printersQuery(workspaceSlug)),
        prefetch(priceCalculatorSettingsQuery(workspaceSlug)),
        ...(usageTracking ? [prefetch(stockQuery(workspaceSlug))] : []),
      ]
    case 'pricing':
      return [prefetch(priceCalculatorSettingsQuery(workspaceSlug))]
    case 'users':
      return [prefetch(usersQuery(workspaceSlug)), prefetch(invitesQuery(workspaceSlug))]
    case 'email':
      return [prefetch(emailBrandingQuery(workspaceSlug))]
    case 'storage':
      return [
        prefetch(storageQuery(workspaceSlug)),
        prefetch(storageMigrationQuery(workspaceSlug)),
        prefetch(cloudConnectionsQuery(workspaceSlug)),
      ]
  }
}

/**
 * Only admins see workspace settings, so loading them for anyone else would only collect authorization errors. The server
 * waits so the section renders with its data; the browser does not, so switching sections is immediate and the pane's
 * own query joins the fetch already in flight instead of repeating it.
 */
export async function preloadSettingsSection(queryClient: QueryClient, section: SettingsSection) {
  const session = await queryClient.ensureQueryData(sessionQuery())
  const workspaceSlug = session.identity?.workspaceSlug
  if (session.identity?.role !== 'admin' || !workspaceSlug) return
  const prefetches = Promise.all(prefetchSettingsSection(queryClient, section, workspaceSlug, session.usageTracking))
  if (typeof document === 'undefined') await prefetches
}
