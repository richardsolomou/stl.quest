import { LOCALES, messagesFor } from './i18n'

// Expected storage validation rejections (`t.storage.problems`), worded once for both sides of the
// server-function boundary. Each is a 400 the operator caused and can fix — an unreadable mount, a
// path that is not a folder, a destination the process cannot write to — and the storage settings UI
// already catches it and shows it inline. The browser telemetry filter matches these catalog
// messages in every language rather than its own copies of the strings, so rewording a message
// cannot quietly start filing error-tracking issues again. The message is all that survives the
// boundary (see `isReportableMutationError`), which is why matching happens on text rather than on a
// status code. The unusable and uninspectable problems carry the underlying filesystem or provider
// detail, which is also why they must never reach error tracking — the detail carries the configured
// storage path, and `docs/telemetry.md` promises those are never sent.
export function isExpectedStorageProblem(message: string) {
  const reported = message.trim()
  return LOCALES.some((locale) => {
    const { unreadable, notAFolder, missing, unusable, uninspectable } = messagesFor(locale).storage.problems
    return (
      [unreadable, notAFolder, missing].includes(reported) ||
      reported.startsWith(unusable('').trimEnd()) ||
      reported.startsWith(uninspectable('').trimEnd())
    )
  })
}
