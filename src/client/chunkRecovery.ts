export const chunkLoadFailureNoticeId = 'chunk-load-failure'

interface ChunkRecoveryOptions {
  storageKey: string
  retryWindowMs: number
  noticeId: string
}

// A failed chunk in the entry module graph fires an error on the entry script
// and leaves inert server HTML with no app code to recover it, so this runs
// inline in <head> and must stay self-contained. TanStack Router already
// reloads once for lazily imported route chunks.
export function installChunkRecovery(win: Window, { storageKey, retryWindowMs, noticeId }: ChunkRecoveryOptions) {
  win.addEventListener(
    'error',
    (event) => {
      if (!(event.target instanceof HTMLScriptElement) || event.target.type !== 'module') return
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

export const chunkRecoveryScript = `(${installChunkRecovery.toString()})(window, ${JSON.stringify({
  storageKey: 'stlquest:chunk-reload',
  retryWindowMs: 10_000,
  noticeId: chunkLoadFailureNoticeId,
} satisfies ChunkRecoveryOptions)})`
