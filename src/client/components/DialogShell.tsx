import { useRef, type ReactNode, type RefObject } from 'react'
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
  status,
  focusDialog = false,
  initialFocus,
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
  /** Whether the dialog's edits are saved, beside the title. */
  status?: ReactNode
  /** Focus the dialog instead of its first control, so opening it neither scrolls to nor arms a button. */
  focusDialog?: boolean
  /** The control to focus on opening, instead of the first one. */
  initialFocus?: RefObject<HTMLElement | null>
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
        initialFocus={initialFocus ?? (focusDialog ? popup : true)}
        showCloseButton={!preventClose}
        className={cn(
          'flex flex-col overflow-hidden max-sm:inset-0 max-sm:h-dvh max-sm:max-w-none max-sm:translate-x-0 max-sm:translate-y-0 max-sm:rounded-none max-sm:ring-0 max-sm:data-open:zoom-in-100 max-sm:data-closed:zoom-out-100 sm:max-h-[calc(100dvh-2.5rem)] sm:max-w-[560px]',
          className,
        )}
      >
        <DialogHeader className="min-w-0 shrink-0 border-b border-border pr-8 pb-3">
          <div className="flex min-w-0 items-center gap-3">
            <DialogTitle className="block min-w-0 flex-1 truncate leading-snug" title={title}>
              {title}
            </DialogTitle>
            {status}
          </div>
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
          <div className="flex shrink-0 flex-wrap justify-end gap-2 border-t border-border pt-3 max-sm:[&>*]:flex-1">{footer}</div>
        )}
      </DialogContent>
    </Dialog>
  )
}
