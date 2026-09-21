import { describe, expect, it } from 'vitest'
import { isExpectedStorageProblem, STORAGE_FOLDER_PROBLEMS } from './storageProblems'

describe('isExpectedStorageProblem', () => {
  it('recognizes every folder listing problem the server can report', () => {
    for (const problem of Object.values(STORAGE_FOLDER_PROBLEMS)) expect(isExpectedStorageProblem(problem)).toBe(true)
  })

  it('recognizes a destination problem with its filesystem detail appended', () => {
    expect(isExpectedStorageProblem("storage is not reachable or not writable: ENOENT: no such file or directory, mkdir '/prints'")).toBe(
      true,
    )
    expect(isExpectedStorageProblem('storage is writable but its contents cannot be inspected: AccessDenied')).toBe(true)
  })

  it('ignores surrounding whitespace', () => {
    expect(isExpectedStorageProblem('  folder is not readable  ')).toBe(true)
  })

  it('does not match a message that merely mentions a folder', () => {
    expect(isExpectedStorageProblem('folder is not readable by the thumbnail worker')).toBe(false)
    expect(isExpectedStorageProblem('storage is not reachable or not writable')).toBe(false)
    expect(isExpectedStorageProblem('Failed to fetch')).toBe(false)
    expect(isExpectedStorageProblem('')).toBe(false)
  })
})
