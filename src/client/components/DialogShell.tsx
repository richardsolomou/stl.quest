import type { ReactNode } from 'react'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { cn } from '@/lib/utils'

export function DialogShell({
  open = true,
  onClose,
  title,
  className,
  children,
  preventClose = false,
}: {
  open?: boolean
  onClose: () => void
  title: string
  className?: string
  children: ReactNode
  preventClose?: boolean
}) {
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
        showCloseButton={!preventClose}
        className={cn(
          'top-4 bottom-4 flex max-h-none translate-y-0 flex-col overflow-hidden sm:top-1/2 sm:bottom-auto sm:max-h-[calc(100dvh-2.5rem)] sm:max-w-[560px] sm:-translate-y-1/2',
          className,
        )}
      >
        <DialogHeader className="min-w-0 shrink-0 pr-8">
          <DialogTitle className="block truncate" title={title}>
            {title}
          </DialogTitle>
        </DialogHeader>
        <div className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto overscroll-contain [-webkit-overflow-scrolling:touch]">
          {children}
        </div>
      </DialogContent>
    </Dialog>
  )
}
