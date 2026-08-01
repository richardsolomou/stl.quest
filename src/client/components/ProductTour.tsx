import { useEffect, useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import { useServerFn } from '@tanstack/react-start'
import { ArrowUpDown, Check, ChevronRight, Database, Filter, Grip, MousePointer2, Printer, Upload } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { onboardingTaskIds, type OnboardingProgress, type OnboardingTaskId } from '../../core/onboarding'
import { updateOnboardingProgress } from '../../server/fns'
import { onboardingQuery } from '../queries'
import { PRODUCT_TOUR_EVENT, PRODUCT_TOUR_PROGRESS_EVENT } from '../productTour'

type Task = {
  id: OnboardingTaskId
  title: string
  description: string
  hint: string
  icon: typeof Upload
  target?: string
  admin?: boolean
  action: string
  route?: '/' | '/settings/$section'
  section?: 'printers' | 'storage'
}

const tasks: Task[] = [
  {
    id: 'upload',
    title: 'Add your first print',
    description: 'Drag STL files anywhere onto the board, or choose them from your computer.',
    hint: 'You can drop several files at once.',
    icon: Upload,
    target: 'upload',
    action: 'Choose files',
    route: '/',
  },
  {
    id: 'move',
    title: 'Move work through the queue',
    description: 'Drag a print card from one column to another to update its stage.',
    hint: 'For multi-copy requests, choose how many copies to move.',
    icon: Grip,
    target: 'request-card',
    action: 'Show the board',
    route: '/',
  },
  {
    id: 'actions',
    title: 'Find more print actions',
    description: 'Right-click a print card to move, group, select, or delete it.',
    hint: 'On a touchscreen, press and hold the card.',
    icon: MousePointer2,
    target: 'request-card',
    action: 'Show the board',
    route: '/',
  },
  {
    id: 'sort',
    title: 'Choose how the queue is sorted',
    description: 'Sort by requester priority, submission time, name, or recent activity.',
    hint: 'Sorting changes your view, not the underlying workflow.',
    icon: ArrowUpDown,
    target: 'sort',
    action: 'Choose a sort',
    route: '/',
  },
  {
    id: 'filter',
    title: 'Focus the board with filters',
    description: 'Narrow the queue by print type, requester, dates, files, and more.',
    hint: 'Active filters are reflected in the URL, so filtered views can be shared.',
    icon: Filter,
    target: 'filters',
    action: 'Open filters',
    route: '/',
  },
  {
    id: 'printers',
    title: 'Add your printer fleet',
    description: 'Printer profiles help match requests to compatible machines.',
    hint: 'You can add presets or enter a printer manually.',
    icon: Printer,
    admin: true,
    action: 'Open printer settings',
    route: '/settings/$section',
    section: 'printers',
  },
  {
    id: 'storage',
    title: 'Know where models are stored',
    description: 'Review the active storage provider and the options for moving models later.',
    hint: 'Opening storage settings completes this task. No configuration is changed.',
    icon: Database,
    admin: true,
    action: 'Review storage',
    route: '/settings/$section',
    section: 'storage',
  },
]

export function ProductTour({ isAdmin }: { isAdmin: boolean }) {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const callUpdate = useServerFn(updateOnboardingProgress)
  const { data } = useQuery(onboardingQuery())
  const available = useMemo(() => tasks.filter((task) => !task.admin || isAdmin), [isAdmin])
  const pending = available.filter((task) => !data?.completedTasks.includes(task.id))
  const [replaying, setReplaying] = useState(false)
  const [selected, setSelected] = useState<OnboardingTaskId>()
  const current = pending.find((task) => task.id === selected) ?? pending[0]
  const snoozed = (data?.snoozedUntil ?? 0) > Date.now()
  const open = !!data && !snoozed && (replaying || pending.length > 0)

  const mutation = useMutation({
    mutationFn: (input: Parameters<typeof callUpdate>[0]) => callUpdate(input),
    onSuccess: (progress) => queryClient.setQueryData(onboardingQuery().queryKey, progress),
  })

  useEffect(() => {
    const replay = () => {
      setReplaying(true)
      setSelected(undefined)
      mutation.mutate({ data: { operation: 'restart' } })
    }
    const progress = (event: Event) => {
      const task = (event as CustomEvent<OnboardingTaskId>).detail
      mutation.mutate({ data: { operation: 'complete', task } })
    }
    window.addEventListener(PRODUCT_TOUR_EVENT, replay)
    window.addEventListener(PRODUCT_TOUR_PROGRESS_EVENT, progress)
    return () => {
      window.removeEventListener(PRODUCT_TOUR_EVENT, replay)
      window.removeEventListener(PRODUCT_TOUR_PROGRESS_EVENT, progress)
    }
  }, [mutation])

  useEffect(() => {
    if (!open || !current?.target) return
    const target = document.querySelector(`[data-onboarding="${current.target}"]`)
    target?.setAttribute('data-onboarding-active', 'true')
    return () => target?.removeAttribute('data-onboarding-active')
  }, [current?.target, open])

  if (!open || !current) return null

  const runAction = async (task: Task) => {
    if (task.route === '/settings/$section' && task.section) {
      await navigate({ to: task.route, params: { section: task.section } })
      return
    }
    if (task.route === '/') await navigate({ to: '/' })
    window.setTimeout(() => document.querySelector<HTMLButtonElement>(`[data-onboarding="${task.target}"]`)?.click(), 0)
  }

  const updateLocal = (progress: OnboardingProgress) => queryClient.setQueryData(onboardingQuery().queryKey, progress)

  return (
    <section
      aria-label="Getting started"
      aria-live="polite"
      className="fixed right-4 bottom-20 z-30 max-h-[calc(100dvh-6rem)] w-[min(27rem,calc(100vw-2rem))] overflow-y-auto rounded-xl border-2 border-blueprint bg-background p-4 shadow-xl"
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <span className="font-heading text-xs tracking-[0.08em] text-muted-foreground uppercase">Getting started</span>
          <h2 className="font-heading text-xl">Learn by doing</h2>
        </div>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-7 shrink-0 px-2 text-xs text-muted-foreground"
          disabled={mutation.isPending}
          onClick={() => mutation.mutate({ data: { operation: 'snooze' } }, { onSuccess: (progress) => updateLocal(progress) })}
        >
          Remind me tomorrow
        </Button>
      </div>
      <div className="mt-4 flex flex-col gap-2">
        {available.map((task) => {
          const done = data.completedTasks.includes(task.id)
          const active = current.id === task.id
          const Icon = task.icon
          return (
            <div
              key={task.id}
              className={cn(
                'rounded-lg border p-3 transition-colors',
                active ? 'border-primary bg-primary/5' : 'border-border hover:bg-muted/50',
              )}
            >
              <button
                type="button"
                className="flex w-full items-center gap-3 text-left"
                onClick={() => {
                  if (!done) setSelected(task.id)
                }}
              >
                <span
                  className={cn(
                    'grid size-8 shrink-0 place-items-center rounded-full bg-muted text-muted-foreground',
                    active && 'bg-primary/15 text-primary',
                    done && 'bg-primary text-primary-foreground',
                  )}
                >
                  {done ? <Check className="size-4" /> : <Icon className="size-4" />}
                </span>
                <span className={cn('flex-1 text-sm font-medium', done && 'text-muted-foreground line-through')}>{task.title}</span>
                {!done && <ChevronRight className={cn('size-4 text-muted-foreground transition-transform', active && 'rotate-90')} />}
              </button>
              {active && !done && (
                <div className="mt-3 border-t border-dashed border-border pt-3 pl-11">
                  <p className="text-sm leading-relaxed text-muted-foreground">{task.description}</p>
                  <p className="mt-2 text-xs text-muted-foreground">{task.hint}</p>
                  <Button type="button" size="sm" className="mt-3" onClick={() => void runAction(task)}>
                    {task.action}
                  </Button>
                </div>
              )}
            </div>
          )
        })}
      </div>
      <div className="mt-4 flex items-center justify-between gap-3">
        <span className="text-xs text-muted-foreground">
          {available.length - pending.length} of {available.length} complete
        </span>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={mutation.isPending}
          onClick={() =>
            mutation.mutate({
              data: { operation: 'skip', tasks: available.map((task) => task.id) },
            })
          }
        >
          Skip guide
        </Button>
      </div>
    </section>
  )
}

export const productTourTaskIds = onboardingTaskIds
