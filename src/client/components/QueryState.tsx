import { CircleAlert } from 'lucide-react'
import { Alert, AlertAction, AlertDescription, AlertTitle } from '../../components/ui/alert'
import { Button } from '../../components/ui/button'
import { Spinner } from '../../components/ui/spinner'
import { cn } from '../../lib/utils'
import { queryErrorMessage, queryStateKind } from '../queryState'

export function QueryState({
  loading,
  error,
  loadingLabel,
  errorTitle,
  onRetry,
  className,
}: {
  loading: boolean
  error: unknown
  loadingLabel: string
  errorTitle: string
  onRetry: () => void
  className?: string
}) {
  if (queryStateKind(loading, error) === 'loading') {
    return (
      <output className={cn('flex items-center justify-center gap-2 p-6 text-muted-foreground', className)}>
        <Spinner /> {loadingLabel}
      </output>
    )
  }

  return (
    <Alert variant="destructive" className={cn('pr-24', className)}>
      <CircleAlert />
      <AlertTitle>{errorTitle}</AlertTitle>
      <AlertDescription>{queryErrorMessage(error)}</AlertDescription>
      <AlertAction>
        <Button type="button" size="sm" variant="outline" onClick={onRetry}>
          Retry
        </Button>
      </AlertAction>
    </Alert>
  )
}
