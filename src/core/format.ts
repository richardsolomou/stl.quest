export function formatBytes(bytes: number) {
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let value = bytes
  let unit = 0
  while (value >= 1_000 && unit < units.length - 1) {
    value /= 1_000
    unit++
  }
  // Rounding can reach the next unit, so a hair under 1 GB reads as 1.0 GB rather than 1000.0 MB.
  if (unit < units.length - 1 && Number(value.toFixed(unit ? 1 : 0)) >= 1_000) {
    value /= 1_000
    unit++
  }
  return `${value.toFixed(unit ? 1 : 0)} ${units[unit]}`
}
