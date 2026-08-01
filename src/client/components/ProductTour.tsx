import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { usePostHog } from '@posthog/react'
import { useSuspenseQuery } from '@tanstack/react-query'
import { useLocation, useNavigate } from '@tanstack/react-router'
import {
  ArrowUpDown,
  Check,
  ChevronRight,
  Database,
  Filter,
  Grip,
  ListChecks,
  MousePointer2,
  PanelRightClose,
  Printer,
  Upload,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { onboardingTaskIds, type OnboardingTaskId } from '../../core/onboarding'
import { sessionQuery } from '../queries'
import {
  PRODUCT_TOUR_EVENT,
  PRODUCT_TOUR_ID,
  PRODUCT_TOUR_PROGRESS_EVENT,
  readProductTourProgress,
  writeProductTourProgress,
  type ProductTourProgress,
} from '../productTour'

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
  page: 'board' | 'printers' | 'storage'
  acknowledge?: boolean
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
    page: 'board',
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
    page: 'board',
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
    page: 'board',
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
    page: 'board',
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
    page: 'board',
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
    page: 'printers',
    target: 'printers',
  },
  {
    id: 'storage',
    title: 'Know where models are stored',
    description: 'Review the active storage provider and the options for moving models later.',
    hint: 'Acknowledge this task when you know where to review storage. No configuration is changed.',
    icon: Database,
    admin: true,
    action: 'Mark as reviewed',
    route: '/settings/$section',
    section: 'storage',
    page: 'storage',
    acknowledge: true,
  },
]

export function ProductTour({ isAdmin }: { isAdmin: boolean }) {
  const navigate = useNavigate()
  const location = useLocation()
  const posthog = usePostHog()
  const {
    data: { identity },
  } = useSuspenseQuery(sessionQuery())
  const userId = identity?.id
  const [progress, setProgress] = useState<ProductTourProgress>({ completedTasks: [] })
  const [loadedUserId, setLoadedUserId] = useState<string>()
  const page =
    location.pathname === '/'
      ? 'board'
      : location.pathname === '/settings/printers'
        ? 'printers'
        : location.pathname === '/settings/storage'
          ? 'storage'
          : undefined
  const available = useMemo(() => tasks.filter((task) => task.page === page && (!task.admin || isAdmin)), [isAdmin, page])
  const eligibleTaskIds = useMemo(
    () => (isAdmin ? onboardingTaskIds : onboardingTaskIds.filter((task) => task !== 'printers' && task !== 'storage')),
    [isAdmin],
  )
  const pending = available.filter((task) => !progress.completedTasks.includes(task.id))
  const [replaying, setReplaying] = useState(false)
  const [expanded, setExpanded] = useState(false)
  const [selected, setSelected] = useState<OnboardingTaskId>()
  const current = pending.find((task) => task.id === selected) ?? pending[0]
  const snoozed = (progress.snoozedUntil ?? 0) > Date.now()
  const open = loadedUserId === userId && !snoozed && (replaying || pending.length > 0)

  const started = useRef(false)
  const updateProgress = useCallback(
    (next: ProductTourProgress) => {
      if (!userId) return
      writeProductTourProgress(localStorage, userId, next)
      setProgress(next)
    },
    [userId],
  )

  const completeTasks = useCallback(
    (completedTasks: readonly OnboardingTaskId[]) => {
      const nextTasks = onboardingTaskIds.filter((task) => progress.completedTasks.includes(task) || completedTasks.includes(task))
      updateProgress({ completedTasks: nextTasks })
      for (const task of completedTasks) posthog.capture('product_tour_task_completed', { tour_id: PRODUCT_TOUR_ID, task })
      if (eligibleTaskIds.every((task) => nextTasks.includes(task))) posthog.capture('product_tour_completed', { tour_id: PRODUCT_TOUR_ID })
    },
    [eligibleTaskIds, posthog, progress.completedTasks, updateProgress],
  )

  useEffect(() => {
    if (!userId) return
    started.current = false
    setProgress(readProductTourProgress(localStorage, userId))
    setLoadedUserId(userId)
  }, [userId])

  useEffect(() => {
    if (!open || started.current) return
    started.current = true
    posthog.capture('product_tour_started', { tour_id: PRODUCT_TOUR_ID, page })
  }, [open, page, posthog])

  useEffect(() => setExpanded(false), [page])

  useEffect(() => {
    const replay = () => {
      started.current = true
      posthog.capture('product_tour_started', { tour_id: PRODUCT_TOUR_ID, page, source: 'restart' })
      setReplaying(true)
      setExpanded(true)
      setSelected(undefined)
      updateProgress({ completedTasks: [] })
    }
    const progressEvent = (event: Event) => {
      const task = (event as CustomEvent<OnboardingTaskId>).detail
      setExpanded(false)
      completeTasks([task])
    }
    window.addEventListener(PRODUCT_TOUR_EVENT, replay)
    window.addEventListener(PRODUCT_TOUR_PROGRESS_EVENT, progressEvent)
    return () => {
      window.removeEventListener(PRODUCT_TOUR_EVENT, replay)
      window.removeEventListener(PRODUCT_TOUR_PROGRESS_EVENT, progressEvent)
    }
  }, [completeTasks, page, posthog, updateProgress])

  useEffect(() => {
    if (!open || !current?.target) return
    const target = document.querySelector(`[data-onboarding="${current.target}"]`)
    target?.setAttribute('data-onboarding-active', 'true')
    return () => target?.removeAttribute('data-onboarding-active')
  }, [current?.target, open])

  if (!open || !current) return null

  if (!expanded) {
    return (
      <Button
        type="button"
        className="fixed right-4 bottom-20 z-30 shadow-lg"
        onClick={() => setExpanded(true)}
        aria-label="Open getting started"
      >
        <ListChecks />
        Getting started · {available.length - pending.length} of {available.length}
      </Button>
    )
  }

  const runAction = async (task: Task) => {
    if (task.acknowledge) {
      completeTasks([task.id])
      return
    }
    if (task.route === '/settings/$section' && task.section) {
      await navigate({ to: task.route, params: { section: task.section } })
    } else if (task.route === '/') await navigate({ to: '/' })
    window.setTimeout(() => {
      const target = document.querySelector<HTMLElement>(`[data-onboarding="${task.target}"]`)
      if (target instanceof HTMLButtonElement) target.click()
      else target?.querySelector<HTMLButtonElement>('button')?.click()
    }, 0)
  }

  return (
    <section
      aria-label="Getting started"
      aria-live="polite"
      className="fixed top-16 right-4 z-30 max-h-[calc(100dvh-5rem)] w-[min(27rem,calc(100vw-2rem))] overflow-y-auto rounded-xl border-2 border-blueprint bg-background p-4 shadow-xl"
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <span className="font-heading text-xs tracking-[0.08em] text-muted-foreground uppercase">Getting started</span>
          <h2 className="font-heading text-xl">Learn by doing</h2>
        </div>
        <div className="flex shrink-0 items-center">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-7 px-2 text-xs text-muted-foreground"
            onClick={() => {
              updateProgress({ ...progress, snoozedUntil: Date.now() + 24 * 60 * 60 * 1000 })
              posthog.capture('product_tour_dismissed', { tour_id: PRODUCT_TOUR_ID, page, reason: 'snoozed' })
            }}
          >
            Remind me tomorrow
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            className="text-muted-foreground"
            onClick={() => setExpanded(false)}
            aria-label="Minimize getting started"
          >
            <PanelRightClose />
          </Button>
        </div>
      </div>
      <div className="mt-4 flex flex-col gap-2">
        {available.map((task) => {
          const done = progress.completedTasks.includes(task.id)
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
                  if (!done) {
                    setSelected(task.id)
                    posthog.capture('product_tour_task_viewed', { tour_id: PRODUCT_TOUR_ID, task: task.id })
                  }
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
          onClick={() => {
            completeTasks(available.map((task) => task.id))
            posthog.capture('product_tour_dismissed', { tour_id: PRODUCT_TOUR_ID, page, reason: 'skipped' })
          }}
        >
          Skip guide
        </Button>
      </div>
    </section>
  )
}

export const productTourTaskIds = onboardingTaskIds
