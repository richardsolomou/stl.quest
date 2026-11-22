export const MAX_STORES = 50

/**
 * Where consumables are bought, and what it charges to ship an order in the workspace currency: `shippingCost` per
 * order, waived once an order reaches `freeShippingOver`. Both are what the user sets, since they vary by country.
 */
export type Store = {
  id: string
  name: string
  shippingCost?: number
  freeShippingOver?: number
  /** Kept so consumables that name it still resolve, but left out of pickers and the shopping list. */
  archived?: boolean
}
