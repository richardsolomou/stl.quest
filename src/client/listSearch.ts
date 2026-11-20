/** A settings list long enough that scanning it stops working, from a small fleet to a farm's. */
const SEARCH_FROM = 8

export function showsListSearch(count: number) {
  return count >= SEARCH_FROM
}

/** Every word of the query must appear in one of the fields, so "bambu x1" finds a printer by brand and model. */
export function matchesListSearch(query: string, fields: (string | undefined)[]) {
  const haystack = fields.filter(Boolean).join(' ').toLocaleLowerCase()
  return query
    .toLocaleLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .every((word) => haystack.includes(word))
}
