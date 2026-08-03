import { useEffect, useState } from 'react'
import { Check } from 'lucide-react'

// Copies `value` to the clipboard, returning whether it succeeded. The async Clipboard API is only
// available in secure contexts, so on a plain-HTTP self-hosted install (e.g. a LAN IP) the browser
// leaves `navigator.clipboard` undefined; feature-detect it and fall back to the legacy execCommand
// path so copy buttons keep working. A rejected write (denied permission) also falls through rather
// than escaping as an unhandled rejection.
export async function writeClipboard(value: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(value)
      return true
    }
  } catch {
    // Fall through to the legacy path below.
  }
  return copyWithExecCommand(value)
}

function copyWithExecCommand(value: string): boolean {
  try {
    const textarea = document.createElement('textarea')
    textarea.value = value
    textarea.setAttribute('readonly', '')
    textarea.style.position = 'fixed'
    textarea.style.opacity = '0'
    document.body.appendChild(textarea)
    textarea.select()
    const copied = document.execCommand('copy')
    document.body.removeChild(textarea)
    return copied
  } catch {
    return false
  }
}

// A copy button can confirm itself. A toast for something this small only covers up the page.
export function useCopied(resetAfterMs = 2000) {
  const [copied, setCopied] = useState(false)
  useEffect(() => {
    if (!copied) return
    const timer = setTimeout(() => setCopied(false), resetAfterMs)
    return () => clearTimeout(timer)
  }, [copied, resetAfterMs])
  return {
    copied,
    copy: (value: string) =>
      void writeClipboard(value).then((success) => {
        if (success) setCopied(true)
      }),
  }
}

export function CopyButtonLabel({ copied }: { copied: boolean }) {
  if (!copied) return 'Copy'
  return (
    <>
      <Check /> Copied
    </>
  )
}
