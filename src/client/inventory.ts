import { useMemo } from 'react'
import { type QueryClient, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useServerFn } from '@tanstack/react-start'
import type { Consumable } from '../core/consumables'
import type { InventoryItem, InventoryItems, InventoryKind } from '../core/inventory'
import type { PriceCalculatorCurrency } from '../core/priceCalculator'
import { landedConsumables, type ShippingTakenOut } from '../core/stores'
import {
  createConsumables,
  createInventoryItem,
  deleteInventoryItem,
  setInventoryItemArchived,
  shareFilamentPrice,
  updateInventoryItem,
} from '../server/fns'
import { consumablesQuery, equipmentQuery, printersQuery, storesQuery } from './queries'
import { invalidateQueries } from './queryState'
import { useWorkspaceSlug } from './workspace'

const queries = { printers: printersQuery, equipment: equipmentQuery, consumables: consumablesQuery, stores: storesQuery }
/** Where each kind's list sits in what its query returns. */
const listField = { printers: 'profiles', equipment: 'equipment', consumables: 'consumables', stores: 'stores' } as const

/** Puts a changed list in its query's cache, keeping whatever else the query returned (a printer's runs). */
export function storeInventory(queryClient: QueryClient, workspaceSlug: string, kind: InventoryKind, items: InventoryItem[]) {
  const { queryKey } = queries[kind](workspaceSlug)
  queryClient.setQueryData(queryKey, (data) => data && { ...data, [listField[kind]]: items })
}

type Change<Kind extends InventoryKind> =
  | { item: InventoryItems[Kind]; shippingTakenOut?: ShippingTakenOut }
  | { id: string; archived: boolean }

/**
 * Saves one printer, piece of equipment, consumable, or store at a time, so admins editing different items never undo each
 * other: `save` creates an item the list does not have yet and updates one it does (a store with what it sells repriced,
 * see `pricedStoreItems`), `setArchived` archives or
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
  // What a store sells is repriced with it, so its consumables are fetched again.
  const changed = async ({ items }: { items: InventoryItem[] }) => {
    storeInventory(queryClient, workspaceSlug, kind, items)
    if (kind === 'stores') await queryClient.invalidateQueries({ queryKey: consumablesQuery(workspaceSlug).queryKey })
  }
  const mutation = useMutation({
    mutationFn: async (change: Change<Kind>) => {
      if ('id' in change) return await archive({ data: { workspaceSlug, inventory: kind, ...change } })
      const known = stored().some(({ id }) => id === change.item.id)
      const data = { workspaceSlug, inventory: kind, item: change.item, shippingTakenOut: change.shippingTakenOut } as Parameters<
        typeof create
      >[0]['data']
      return await (known ? update({ data }) : create({ data }))
    },
    onSuccess: changed,
  })
  // Kept apart from `mutation`, so a failed delete is told in its confirmation rather than the page's notice.
  const deletion = useMutation({
    mutationFn: async (id: string) => await destroy({ data: { workspaceSlug, inventory: kind, id } }),
    onSuccess: changed,
  })
  return {
    mutation,
    save: async (item: InventoryItems[Kind], shippingTakenOut?: ShippingTakenOut) =>
      void (await mutation.mutateAsync({ item, shippingTakenOut })),
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
  const store = ({ items }: { items: Consumable[] }) => storeInventory(queryClient, workspaceSlug, 'consumables', items)
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

/** The library as quotes price it: in the workspace currency, with each store's shipping spread over its prices. */
export function usePricedConsumables(workspaceSlug: string, currency: PriceCalculatorCurrency) {
  const consumables = useQuery(consumablesQuery(workspaceSlug)).data?.consumables
  const stores = useQuery(storesQuery(workspaceSlug)).data?.stores
  return useMemo(() => landedConsumables(consumables ?? [], stores ?? [], currency), [consumables, stores, currency])
}
