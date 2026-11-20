import { useEffect, useEffectEvent, type ReactNode } from 'react'
import { useDropzone } from 'react-dropzone'
import { cn } from '@/lib/utils'
import { firstImage } from '../coverImage'

/**
 * Takes a cover image by click, by drop, or by a paste anywhere on the page while it is shown, since copying the
 * picture on a model page is the natural way to bring one over. `noDrag` leaves drops to a page that routes them.
 */
export function CoverDrop({
  id,
  label,
  disabled = false,
  noDrag = false,
  className,
  onImage,
  children,
}: {
  id?: string
  label: string
  disabled?: boolean
  noDrag?: boolean
  className?: string
  onImage: (file: File) => void
  children: ReactNode
}) {
  const take = useEffectEvent(onImage)
  useEffect(() => {
    if (disabled) return
    const onPaste = (event: ClipboardEvent) => {
      const image = firstImage(event.clipboardData?.files ?? [])
      if (!image) return
      event.preventDefault()
      take(image)
    }
    window.addEventListener('paste', onPaste)
    return () => window.removeEventListener('paste', onPaste)
  }, [disabled])
  const dropzone = useDropzone({
    accept: { 'image/*': [] },
    multiple: false,
    disabled,
    noDrag,
    onDropAccepted: ([file]) => {
      if (file) onImage(file)
    },
  })

  return (
    <div
      {...dropzone.getRootProps({
        role: 'button',
        'aria-label': label,
        'aria-disabled': disabled,
        className: cn(
          'group relative cursor-pointer rounded-lg outline-none focus-visible:ring-3 focus-visible:ring-ring/50',
          dropzone.isDragActive && '[&_[data-cover-prompt]]:border-primary',
          className,
        ),
      })}
    >
      <input {...dropzone.getInputProps({ id })} />
      {children}
    </div>
  )
}

/** The dashed render-ground slot a cover goes into, inviting a paste, drop, or pick. */
export function CoverPrompt({ prompt, hint, className }: { prompt: string; hint: string; className?: string }) {
  return (
    <div
      data-cover-prompt
      className={cn(
        'grid size-full content-center justify-items-center gap-1 rounded-lg border-2 border-dashed border-foreground/20 bg-thumb p-3 text-center transition-colors group-hover:border-primary',
        className,
      )}
    >
      <span className="text-sm font-semibold text-foreground">{prompt}</span>
      <span className="text-xs text-muted-foreground">{hint}</span>
    </div>
  )
}
