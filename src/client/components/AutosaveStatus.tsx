import { Check } from 'lucide-react'
import { Spinner } from '@/components/ui/spinner'
import { cn } from '@/lib/utils'
import type { AutosaveStatus as Status } from '../autosave'
import { useI18n } from '../i18n'
import { useAutosaveScopeStatus } from '../useAutosave'

/** Whether edits have reached storage: Saving… while one waits or runs, Saved after, and a retry when one failed. */
export function AutosaveStatus({ status, onRetry, className }: { status: Status; onRetry: () => void; className?: string }) {
  const copy = useI18n().t.common.autosave
  return (
    <output className={cn('inline-flex min-h-5 items-center gap-1.5 text-xs whitespace-nowrap empty:hidden', className)}>
      {(status === 'pending' || status === 'saving') && (
        <span className="inline-flex items-center gap-1.5 text-muted-foreground">
          <Spinner aria-hidden="true" className="size-3" />
          {copy.saving}
        </span>
      )}
      {status === 'saved' && (
        <span className="inline-flex items-center gap-1 text-muted-foreground">
          <Check aria-hidden="true" className="size-3.5" />
          {copy.saved}
        </span>
      )}
      {status === 'error' && (
        <>
          <span className="font-medium text-destructive">{copy.failed}</span>
          <span aria-hidden="true" className="text-muted-foreground">
            ·
          </span>
          <button type="button" className="cursor-pointer font-medium text-foreground underline underline-offset-2" onClick={onRetry}>
            {copy.retry}
          </button>
        </>
      )}
    </output>
  )
}

/** The status of every autosaved form on the page, for its header. */
export function PageAutosaveStatus() {
  const { status, retry } = useAutosaveScopeStatus()
  return <AutosaveStatus status={status} onRetry={retry} />
}
