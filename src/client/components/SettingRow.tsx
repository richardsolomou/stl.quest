import type { ReactNode } from 'react'
import { CircleAlert } from 'lucide-react'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'

export type SettingRowStatus = { label: string; tone: 'on' | 'ready' | 'off' }

// One shape for every "thing you can turn on or set up" list: identity on the left, true state in the badge, actions on the right.
export function SettingRow({
  icon,
  name,
  status,
  detail,
  actions,
  problem,
}: {
  icon: ReactNode
  name: string
  status: SettingRowStatus
  detail: ReactNode
  actions: ReactNode
  problem?: string
}) {
  return (
    <section aria-label={name} className="rounded-lg border bg-card p-3">
      <div className="flex items-start gap-3">
        <span className="grid size-10 shrink-0 place-items-center rounded-lg bg-muted [&>svg]:size-5">{icon}</span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-medium">{name}</span>
            <Badge variant={status.tone === 'on' ? 'default' : status.tone === 'ready' ? 'outline' : 'secondary'}>{status.label}</Badge>
          </div>
          <p className="mt-0.5 text-sm leading-relaxed text-muted-foreground">{detail}</p>
        </div>
        <div className="flex shrink-0 flex-wrap items-center justify-end gap-2 max-sm:hidden">{actions}</div>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2 sm:hidden">{actions}</div>
      {problem && (
        <Alert variant="destructive" className="mt-3">
          <CircleAlert />
          <AlertDescription>{problem}</AlertDescription>
        </Alert>
      )}
    </section>
  )
}
