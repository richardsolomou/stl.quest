import { CircleAlert } from 'lucide-react'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'

// Failures belong beside the fields that caused them, with what to check above the server's own wording.
export function DialogProblem({ title, hint, error }: { title: string; hint: string; error?: string }) {
  if (!error) return null
  return (
    <Alert variant="destructive">
      <CircleAlert />
      <AlertTitle>{title}</AlertTitle>
      <AlertDescription className="flex flex-col gap-1">
        <span>{hint}</span>
        <span className="text-xs break-words opacity-80">{error}</span>
      </AlertDescription>
    </Alert>
  )
}
