import { toast } from 'sonner'
import { Button } from '@/components/ui/button'

export function CopyableValue({ label, value, description }: { label: string; value: string; description?: string }) {
  return (
    <div className="space-y-1.5">
      <p className="text-sm font-medium">{label}</p>
      <div className="flex items-center gap-2 rounded-lg border bg-muted/40 p-2">
        <code className="min-w-0 flex-1 break-all text-xs">{value}</code>
        <Button
          type="button"
          variant="outline"
          size="sm"
          aria-label={`Copy ${label}`}
          onClick={() => void navigator.clipboard.writeText(value).then(() => toast.success(`${label} copied.`))}
        >
          Copy
        </Button>
      </div>
      {description && <p className="text-sm text-muted-foreground">{description}</p>}
    </div>
  )
}
