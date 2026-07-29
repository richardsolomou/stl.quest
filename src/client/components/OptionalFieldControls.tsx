import type { ReactNode } from 'react'
import { Plus, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'

export function RemovableField({
  children,
  removeLabel,
  onRemove,
  className,
}: {
  children: ReactNode
  removeLabel: string
  onRemove?: () => void
  className?: string
}) {
  return (
    <div className={cn('flex items-start gap-2', className)}>
      {children}
      {onRemove && (
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                className="shrink-0 text-muted-foreground hover:text-destructive"
                aria-label={removeLabel}
                onClick={onRemove}
              />
            }
          >
            <X />
          </TooltipTrigger>
          <TooltipContent>{removeLabel}</TooltipContent>
        </Tooltip>
      )}
    </div>
  )
}

export function AddOptionalFieldButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      className="h-8 w-full justify-start px-2 text-xs text-muted-foreground sm:h-auto sm:w-auto sm:px-0"
      onClick={onClick}
    >
      <Plus />
      {label}
    </Button>
  )
}
