// Expected storage validation rejections, worded once for both sides of the server-function
// boundary. Each is a 400 the operator caused and can fix — an unreadable mount, a path that is not
// a folder, a destination the process cannot write to — and the storage settings UI already catches
// it and shows it inline. The browser telemetry filter matches these same constants rather than its
// own copies of the strings, so rewording a message here cannot quietly start filing error-tracking
// issues again. The message is all that survives the boundary (see `isReportableMutationError`),
// which is why matching happens on text rather than on a status code.
export const STORAGE_FOLDER_PROBLEMS = {
  unreadable: 'folder is not readable',
  notAFolder: 'path is not a folder',
  missing: 'folder does not exist',
} as const

// Prefixes: each of these is reported with the underlying filesystem or provider detail appended,
// which is also why they must never reach error tracking — the detail carries the configured
// storage path, and `docs/telemetry.md` promises those are never sent.
export const STORAGE_UNUSABLE_PROBLEM = 'storage is not reachable or not writable'
export const STORAGE_UNINSPECTABLE_PROBLEM = 'storage is writable but its contents cannot be inspected'

export function isExpectedStorageProblem(message: string) {
  const reported = message.trim()
  return (
    Object.values(STORAGE_FOLDER_PROBLEMS).some((problem) => problem === reported) ||
    reported.startsWith(`${STORAGE_UNUSABLE_PROBLEM}:`) ||
    reported.startsWith(`${STORAGE_UNINSPECTABLE_PROBLEM}:`)
  )
}
