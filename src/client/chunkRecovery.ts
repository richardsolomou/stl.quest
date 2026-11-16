export const updateNoticeId = 'chunk-load-failure'

// Serialized into an inline <head> script, so it must stay self-contained: no imports, helpers, or closures.
function installChunkRecovery(
  win: Window,
  { storageKey, noticeId, retryWindowMs }: { storageKey: string; noticeId: string; retryWindowMs: number },
) {
  win.addEventListener(
    'error',
    (event) => {
      const script = event.target as HTMLScriptElement | null
      if (script?.tagName !== 'SCRIPT' || script.type !== 'module' || !script.src) return
      // Module scripts from elsewhere, such as browser extensions, are not part of the application's build.
      if (new URL(script.src).origin !== win.location.origin) return
      try {
        if (Date.now() - Number(win.sessionStorage.getItem(storageKey)) >= retryWindowMs) {
          win.sessionStorage.setItem(storageKey, String(Date.now()))
          win.location.reload()
          return
        }
      } catch {
        // Without sessionStorage a reload cannot be bounded, so fall through to the notice.
      }
      const notice = win.document.getElementById(noticeId)
      if (notice) notice.hidden = false
    },
    true,
  )
}

/**
 * Reloads the page, at most once per retry window, when an entry module fails to load because a deploy replaced the
 * build, and reveals the update notice once reloading stops. TanStack Router already reloads for lazy route chunks;
 * this covers the entry graph it cannot reach, without which the server-rendered page stays inert.
 */
export const chunkRecoveryScript = `(${installChunkRecovery.toString()})(window, ${JSON.stringify({ storageKey: 'stlquest:chunk-reload', noticeId: updateNoticeId, retryWindowMs: 10_000 })})`
