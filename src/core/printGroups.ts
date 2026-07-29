export const MAX_PRINT_GROUP_NAME_LENGTH = 80

export function validPrintGroupName(name: string) {
  const normalized = name.trim()
  return normalized.length > 0 && normalized.length <= MAX_PRINT_GROUP_NAME_LENGTH
}
