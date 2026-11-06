import { describe, expect, it } from 'vitest'
import { LOCALES, messagesFor } from './i18n'
import { isExpectedStorageProblem } from './storageProblems'

describe('isExpectedStorageProblem', () => {
  it.each(LOCALES)('recognizes every folder listing problem the server can report in %s', (locale) => {
    const { unreadable, notAFolder, missing } = messagesFor(locale).storage.problems
    for (const problem of [unreadable, notAFolder, missing]) expect(isExpectedStorageProblem(problem)).toBe(true)
  })

  it.each(LOCALES)('recognizes a destination problem with its detail appended in %s', (locale) => {
    expect(isExpectedStorageProblem(messagesFor(locale).storage.problems.unusable('EACCES'))).toBe(true)
  })

  it.each(LOCALES)('recognizes an uninspectable destination with its detail appended in %s', (locale) => {
    expect(isExpectedStorageProblem(messagesFor(locale).storage.problems.uninspectable('AccessDenied'))).toBe(true)
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
