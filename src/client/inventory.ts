import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useServerFn } from '@tanstack/react-start'
import type { Consumable } from '../core/consumables'
import type { InventoryItems, InventoryKind } from '../core/inventory'
import { createConsumables, createInventoryItem, deleteInventoryItem, setInventoryItemArchived, shareFilamentPrice, updateInventoryItem } from '../server/fns'
import { consumablesQuery, equipmentQuery, printersQuery } from './queries'
import { invalidateQueries } from './queryState'
import { useWorkspaceSlug } from './workspace'

const queries = { printers: printersQuery, equipment: equipmentQuery, consumables: consumablesQuery }
/** Where each kind's list sits in what its query returns. */
const listField = { printers: 'profiles', equipment: 'equipment', consumables: 'consumables' } as const

type Change<Kind extends InventoryKind> = { item: InventoryItems[Kind] } | { id: string; archived: boolean }

/**
 * Saves one printer, piece of equipment, or consumable at a time, so admins editing different items never undo each
 * other: `save` creates an item the list does not have yet and updates one it does, `setArchived` archives or
 * restores one, and `remove` deletes an archived one. Each result replaces the cached list straight away; the workspace channel refreshes everyone else.
 */
export function useInventory<Kind extends InventoryKind>(kind: Kind) {
  const workspaceSlug = useWorkspaceSlug()
  const queryClient = useQueryClient()
  const create = useServerFn(createInventoryItem)
  const update = useServerFn(updateInventoryItem)
  const archive = useServerFn(setInventoryItemArchived)
  const destroy = useServerFn(deleteInventoryItem)
  const { queryKey } = queries[kind](workspaceSlug)
  const stored = (): InventoryItems[Kind][] =>
    queryClient.getQueryData<Record<string, InventoryItems[Kind][]>>(queryKey)?.[listField[kind]] ?? []
  const mutation = useMutation({
    mutationFn: async (change: Change<Kind>) => {
      if ('id' in change) return await archive({ data: { workspaceSlug, inventory: kind, ...change } })
      const known = stored().some(({ id }) => id === change.item.id)
      const data = { workspaceSlug, inventory: kind, item: change.item } as Parameters<typeof create>[0]['data']
      return await (known ? update({ data }) : create({ data }))
    },
    onSuccess: ({ items }) => queryClient.setQueryData(queryKey, { [listField[kind]]: items } as never),
  })
  // Kept apart from `mutation`, so a failed delete is told in its confirmation rather than the page's notice.
  const deletion = useMutation({
    mutationFn: async (id: string) => await destroy({ data: { workspaceSlug, inventory: kind, id } }),
    onSuccess: ({ items }) => queryClient.setQueryData(queryKey, { [listField[kind]]: items } as never),
  })
  return {
    mutation,
    save: async (item: InventoryItems[Kind]) => void (await mutation.mutateAsync({ item })),
    setArchived: async (id: string, archived: boolean) => void (await mutation.mutateAsync({ id, archived })),
    remove: async (id: string) => void (await deletion.mutateAsync(id)),
  }
}

/**
 * Changes to several consumables at once, each under one server lock: adding the colours of one filament, counted at
 * one amount on hand (in the consumable's own unit) while stock is tracked, or giving one filament's price to the other
 * colours of its product.
 */
export function useConsumableBatch() {
  const workspaceSlug = useWorkspaceSlug()
  const queryClient = useQueryClient()
  const create = useServerFn(createConsumables)
  const share = useServerFn(shareFilamentPrice)
  const store = ({ items }: { items: Consumable[] }) =>
    queryClient.setQueryData(consumablesQuery(workspaceSlug).queryKey, { consumables: items })
  const add = useMutation({
    mutationFn: ({ items, onHand }: { items: Consumable[]; onHand?: number }) => create({ data: { workspaceSlug, items, onHand } }),
    onSuccess: async (result, { onHand }) => {
      store(result)
      if (onHand !== undefined) await invalidateQueries(queryClient, 'stock', 'usage')
    },
  })
  const sharePrice = useMutation({
    mutationFn: (consumableId: string) => share({ data: { workspaceSlug, consumableId } }),
    onSuccess: store,
  })
  return { add, sharePrice }
}
