import { useQuery } from '@tanstack/react-query'
import { appPath } from '../basePath'
import { resolvedSlicer } from '../core/slicers'
import { consumablesQuery, printersQuery, usagePrefillsQuery } from './queries'
import { useUsageTracking, useWorkspaceSlug } from './workspace'

/**
 * The slicer a printer sends its files to, or the material last recorded on that printer when it names its own, which
 * only usage tracking knows; only admins set printers up, so only they look it up.
 */
export function usePrinterSlicer(printerId: string | undefined, isAdmin: boolean) {
  const workspaceSlug = useWorkspaceSlug()
  const tracking = useUsageTracking()
  const printer = useQuery({ ...printersQuery(workspaceSlug), enabled: isAdmin && Boolean(printerId) }).data?.profiles.find(
    ({ id }) => id === printerId,
  )
  const materials = Boolean(printer) && tracking
  const consumables = useQuery({ ...consumablesQuery(workspaceSlug), enabled: materials }).data?.consumables
  const loaded = useQuery({ ...usagePrefillsQuery(workspaceSlug), enabled: materials }).data?.materials[printer?.id ?? '']
  const material = consumables?.find((consumable) => consumable.id === loaded && !consumable.archived)
  return resolvedSlicer(printer, material && (material.kind === 'resin' || material.kind === 'filament') ? material : undefined)
}

/** A signed slicer link as the absolute URL the slicer fetches, on the public origin and base path the browser uses. */
export function slicerFileUrl(path: string) {
  return new URL(appPath(path), window.location.origin).href
}
