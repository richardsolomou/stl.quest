import { useEffect, useState } from 'react'
import { Check } from 'lucide-react'

// A copy button can confirm itself. A toast for something this small only covers up the page.
export function useCopied(resetAfterMs = 2000) {
  const [copied, setCopied] = useState(false)
  useEffect(() => {
    if (!copied) return
    const timer = setTimeout(() => setCopied(false), resetAfterMs)
    return () => clearTimeout(timer)
  }, [copied, resetAfterMs])
  return { copied, copy: (value: string) => void navigator.clipboard.writeText(value).then(() => setCopied(true)) }
}

export function CopyButtonLabel({ copied }: { copied: boolean }) {
  if (!copied) return 'Copy'
  return (
    <>
      <Check /> Copied
    </>
  )
}
