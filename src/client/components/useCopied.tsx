import { useEffect, useState } from 'react'
import { Check } from 'lucide-react'
import { useI18n } from '../i18n'

// The async Clipboard API is undefined outside secure contexts, such as a self-hosted install on a plain-HTTP LAN address,
// and a denied write rejects, so both fall back to the legacy execCommand path.
export async function writeClipboard(value: string): Promise<{ copied: boolean; method: 'clipboard' | 'fallback' }> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(value)
      return { copied: true, method: 'clipboard' }
    }
  } catch {}
  return { copied: copyWithExecCommand(value), method: 'fallback' }
}

// Restores any existing selection afterwards, so nothing appears selected.
function copyWithExecCommand(value: string): boolean {
  try {
    const textarea = document.createElement('textarea')
    textarea.value = value
    textarea.setAttribute('readonly', '')
    textarea.style.cssText = 'position:fixed;top:0;left:0;opacity:0;pointer-events:none'
    document.body.append(textarea)
    const selection = getSelection()
    const selected = selection && selection.rangeCount > 0 ? selection.getRangeAt(0).cloneRange() : null
    textarea.select()
    const copied = document.execCommand('copy')
    textarea.remove()
    selection?.removeAllRanges()
    if (selected) selection?.addRange(selected)
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
      void writeClipboard(value).then((result) => {
        if (result.copied) setCopied(true)
      }),
  }
}

export function CopyButtonLabel({ copied }: { copied: boolean }) {
  const { t } = useI18n()
  if (!copied) return t.common.copy
  return (
    <>
      <Check /> {t.common.copied}
    </>
  )
}
