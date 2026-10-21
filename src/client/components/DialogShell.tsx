import { useRef, type ReactNode } from 'react'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { cn } from '@/lib/utils'

export function DialogShell({
  open = true,
  onClose,
  title,
  description,
  className,
  contentClassName,
  children,
  footer,
  focusDialog = false,
  preventClose = false,
}: {
  open?: boolean
  onClose: () => void
  title: string
  description?: ReactNode
  className?: string
  contentClassName?: string
  children: ReactNode
  /** Stays visible below the scrolling body. */
  footer?: ReactNode
  /** Focus the dialog instead of its first control, so opening it neither scrolls to nor arms a button. */
  focusDialog?: boolean
  preventClose?: boolean
}) {
  const popup = useRef<HTMLDivElement>(null)
  return (
    <Dialog
      open={open}
      disablePointerDismissal={preventClose}
      onOpenChange={(next, details) => {
        if (!next && preventClose) {
          details.cancel()
          return
        }
        if (!next) onClose()
      }}
    >
      <DialogContent
        ref={popup}
        initialFocus={focusDialog ? popup : true}
        showCloseButton={!preventClose}
        className={cn(
          'top-4 bottom-4 flex max-h-none translate-y-0 flex-col overflow-hidden sm:top-1/2 sm:bottom-auto sm:max-h-[calc(100dvh-2.5rem)] sm:max-w-[560px] sm:-translate-y-1/2',
          className,
        )}
      >
        <DialogHeader className="min-w-0 shrink-0 border-b-2 border-dashed border-blueprint/25 pr-8 pb-3">
          <DialogTitle className="block truncate leading-snug" title={title}>
            {title}
          </DialogTitle>
          {description && <DialogDescription className="text-sm leading-relaxed">{description}</DialogDescription>}
        </DialogHeader>
        <div
          className={cn(
            'min-h-0 flex-1 space-y-3 overflow-x-hidden overflow-y-auto overscroll-contain [scrollbar-gutter:stable] [-webkit-overflow-scrolling:touch]',
            contentClassName,
          )}
        >
          {children}
        </div>
        {footer && (
          <div className="flex shrink-0 flex-wrap justify-end gap-2 border-t-2 border-dashed border-blueprint/25 pt-3 max-sm:[&>*]:flex-1">
            {footer}
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
