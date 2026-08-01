import { useCallback, useEffect, useMemo, useState } from 'react'
import { usePostHog } from '@posthog/react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useLocation, useNavigate } from '@tanstack/react-router'
import { useServerFn } from '@tanstack/react-start'
import { Check, Circle, Flag, RotateCcw, Sparkles } from 'lucide-react'
import { EVENTS, Joyride, type EventData, type Step, type TooltipRenderProps } from 'react-joyride'
import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import {
  onboardingPoints,
  onboardingTaskIds,
  onboardingTaskPoints,
  type OnboardingProgress,
  type OnboardingTaskId,
} from '../../core/onboarding'
import { updateOnboardingProgress } from '../../server/fns'
import { onboardingQuery } from '../queries'
import { PRODUCT_QUEST_EVENT, PRODUCT_TOUR_ID, PRODUCT_TOUR_PROGRESS_EVENT } from '../productTour'

type TourPage = 'board' | 'printers' | 'storage'

type Task = {
  id: OnboardingTaskId
  title: string
  description: string
  hint: string
  target: string
  placement?: Step['placement']
  admin?: boolean
  page: TourPage
}

type StepData = { task: Task }

const tasks: Task[] = [
  {
    id: 'upload',
    title: 'Add your first print',
    description: 'Add one or several STL files when you are ready to put work into the queue.',
    hint: 'You can also drag files anywhere onto the board.',
    target: 'upload',
    placement: 'bottom-start',
    page: 'board',
  },
  {
    id: 'move',
    title: 'Move work through the queue',
    description: 'Drag a print card between columns to update its stage.',
    hint: 'For multi-copy requests, STL Quest asks how many copies to move.',
    target: 'request-card',
    placement: 'right',
    admin: true,
    page: 'board',
  },
  {
    id: 'actions',
    title: 'Discover print actions',
    description: 'Right-click a print card to move, group, select, or delete it.',
    hint: 'On a touchscreen, press and hold the card.',
    target: 'request-card',
    placement: 'right',
    admin: true,
    page: 'board',
  },
  {
    id: 'sort',
    title: 'Choose your queue view',
    description: 'Sort by requester priority, submission time, name, or recent activity.',
    hint: 'Sorting changes your view, not the underlying workflow.',
    target: 'sort',
    placement: 'bottom-end',
    page: 'board',
  },
  {
    id: 'filter',
    title: 'Find work with filters',
    description: 'Narrow the queue by print type, requester, dates, files, and more.',
    hint: 'Filtered views are reflected in the URL, so you can share them.',
    target: 'filters',
    placement: 'bottom-end',
    page: 'board',
  },
  {
    id: 'printers',
    title: 'Assemble your printer fleet',
    description: 'Printer profiles help match requests to compatible machines.',
    hint: 'Add a preset or enter a custom printer here.',
    target: 'printers',
    placement: 'top',
    admin: true,
    page: 'printers',
  },
  {
    id: 'storage',
    title: 'Inspect model storage',
    description: 'See the active storage provider and the options for moving models later.',
    hint: 'The quest never changes your storage configuration.',
    target: 'storage',
    placement: 'top',
    admin: true,
    page: 'storage',
  },
]

const focusedQuestKey = 'stlquest:focused-quest'

export function ProductTour({ isAdmin }: { isAdmin: boolean }) {
  const location = useLocation()
  const navigate = useNavigate()
  const posthog = usePostHog()
  const queryClient = useQueryClient()
  const callUpdate = useServerFn(updateOnboardingProgress)
  const { data } = useQuery(onboardingQuery())
  const page = pageFromPath(location.pathname)
  const applicable = useMemo(() => tasks.filter((task) => !task.admin || isAdmin), [isAdmin])
  const [open, setOpen] = useState(false)
  const [focusedTask, setFocusedTask] = useState<OnboardingTaskId | undefined>(() => {
    if (typeof window === 'undefined') return undefined
    const stored = sessionStorage.getItem(focusedQuestKey)
    return onboardingTaskIds.find((task) => task === stored)
  })
  const [targets, setTargets] = useState<Set<OnboardingTaskId>>(new Set())
  const [celebrating, setCelebrating] = useState(false)

  const mutation = useMutation({
    mutationFn: (input: Parameters<typeof callUpdate>[0]) => callUpdate(input),
    onSuccess: (progress) => queryClient.setQueryData(onboardingQuery().queryKey, progress),
  })
  const updateProgress = useCallback(
    (operation: Parameters<typeof callUpdate>[0]['data']) => mutation.mutate({ data: operation }),
    [mutation],
  )

  useEffect(() => {
    const showQuest = () => setOpen(true)
    window.addEventListener(PRODUCT_QUEST_EVENT, showQuest)
    return () => window.removeEventListener(PRODUCT_QUEST_EVENT, showQuest)
  }, [])

  useEffect(() => {
    if (!page) return
    const refresh = () => {
      const found = new Set(
        applicable
          .filter((task) => task.page === page && document.querySelector(`[data-onboarding="${task.target}"]`))
          .map((task) => task.id),
      )
      setTargets((current) => (sameTasks(current, found) ? current : found))
    }
    refresh()
    const observer = new MutationObserver(refresh)
    observer.observe(document.body, { childList: true, subtree: true })
    return () => observer.disconnect()
  }, [applicable, page])

  useEffect(() => {
    const complete = (event: Event) => {
      const task = (event as CustomEvent<OnboardingTaskId>).detail
      setFocusedTask(undefined)
      sessionStorage.removeItem(focusedQuestKey)
      if (data?.completedTasks.includes(task)) return
      updateProgress({ operation: 'complete', task })
      posthog.capture('product_tour_task_completed', { tour_id: PRODUCT_TOUR_ID, task, source: 'interaction' })
    }
    window.addEventListener(PRODUCT_TOUR_PROGRESS_EVENT, complete)
    return () => window.removeEventListener(PRODUCT_TOUR_PROGRESS_EVENT, complete)
  }, [data?.completedTasks, posthog, updateProgress])

  useEffect(() => {
    if (!data || mutation.isPending || celebrating) return
    const resolved = new Set([...data.completedTasks, ...data.skippedTasks])
    if (!applicable.every((task) => resolved.has(task.id))) return
    const newTasks = applicable.filter((task) => !data.celebratedTasks.includes(task.id))
    if (!newTasks.length) return
    setCelebrating(true)
    updateProgress({ operation: 'celebrate', tasks: applicable.map((task) => task.id) })
    posthog.capture('product_tour_completed', {
      tour_id: PRODUCT_TOUR_ID,
      completed: applicable.filter((task) => data.completedTasks.includes(task.id)).length,
      skipped: applicable.filter((task) => data.skippedTasks.includes(task.id)).length,
    })
  }, [applicable, celebrating, data, mutation.isPending, posthog, updateProgress])

  useEffect(() => {
    if (!celebrating) return
    const timeout = window.setTimeout(() => setCelebrating(false), 3_500)
    return () => window.clearTimeout(timeout)
  }, [celebrating])

  const pending = useMemo(
    () => applicable.filter((task) => !data?.completedTasks.includes(task.id) && !data?.skippedTasks.includes(task.id)),
    [applicable, data?.completedTasks, data?.skippedTasks],
  )
  const available = pending.find((task) => task.page === page && targets.has(task.id))
  const focused = focusedTask && applicable.find((task) => task.id === focusedTask && task.page === page && targets.has(task.id))
  const active = focused ?? available
  const step = useMemo<Step | undefined>(
    () =>
      active && {
        id: active.id,
        target: `[data-onboarding="${active.target}"]`,
        title: active.title,
        content: active.description,
        placement: active.placement,
        data: { task: active } satisfies StepData,
      },
    [active],
  )

  useEffect(() => {
    const element = !open && active ? document.querySelector(`[data-onboarding="${active.target}"]`) : undefined
    element?.setAttribute('data-onboarding-active', 'true')
    return () => element?.removeAttribute('data-onboarding-active')
  }, [active, open])

  const launch = async (task: Task) => {
    setOpen(false)
    setFocusedTask(task.id)
    sessionStorage.setItem(focusedQuestKey, task.id)
    posthog.capture('product_tour_started', { tour_id: PRODUCT_TOUR_ID, task: task.id, source: 'quest_list' })
    if (task.page === 'board') await navigate({ to: '/' })
    else await navigate({ to: '/settings/$section', params: { section: task.page } })
  }

  const points = data
    ? onboardingPoints(
        data.completedTasks,
        applicable.map((task) => task.id),
      )
    : 0
  const totalPoints = applicable.reduce((total, task) => total + onboardingTaskPoints[task.id], 0)
  const resolvedCount = data
    ? applicable.filter((task) => data.completedTasks.includes(task.id) || data.skippedTasks.includes(task.id)).length
    : 0

  return (
    <>
      <QuestPopover
        applicable={applicable}
        data={data}
        open={open}
        setOpen={setOpen}
        points={points}
        totalPoints={totalPoints}
        resolvedCount={resolvedCount}
        busy={mutation.isPending}
        launch={launch}
        updateProgress={updateProgress}
      />
      {step && data && !open && (
        <Joyride
          key={`${page}:${step.id}`}
          run
          steps={[step]}
          onEvent={(event: EventData) => {
            if (event.type === EVENTS.TOOLTIP) {
              posthog.capture('product_tour_task_viewed', {
                tour_id: PRODUCT_TOUR_ID,
                task: (event.step.data as StepData).task.id,
              })
            }
          }}
          tooltipComponent={QuestTooltip}
          options={{
            blockTargetInteraction: false,
            buttons: [],
            disableFocusTrap: true,
            dismissKeyAction: false,
            hideOverlay: true,
            overlayClickAction: false,
            skipBeacon: true,
            spotlightPadding: 6,
            spotlightRadius: 8,
            targetWaitTimeout: 2_000,
            zIndex: 40,
          }}
        />
      )}
      {celebrating && <QuestCelebration points={points} />}
    </>
  )
}

function QuestPopover({
  applicable,
  data,
  open,
  setOpen,
  points,
  totalPoints,
  resolvedCount,
  busy,
  launch,
  updateProgress,
}: {
  applicable: Task[]
  data?: OnboardingProgress
  open: boolean
  setOpen: (open: boolean) => void
  points: number
  totalPoints: number
  resolvedCount: number
  busy: boolean
  launch: (task: Task) => void
  updateProgress: (operation: Parameters<ReturnType<typeof useServerFn<typeof updateOnboardingProgress>>>[0]['data']) => void
}) {
  const complete = resolvedCount === applicable.length
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <Tooltip>
        <TooltipTrigger
          render={
            <PopoverTrigger
              render={
                <button
                  type="button"
                  className={cn(
                    'relative grid size-9 cursor-pointer place-items-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground',
                    !complete && 'text-primary',
                  )}
                  aria-label={`STL Quest, ${resolvedCount} of ${applicable.length} resolved, ${points} XP`}
                />
              }
            />
          }
        >
          <Flag className="size-[18px]" />
          {!complete && <span className="absolute top-0.5 right-0.5 size-2 rounded-full bg-primary ring-2 ring-background" />}
        </TooltipTrigger>
        <TooltipContent side="right">Complete your STL Quest</TooltipContent>
      </Tooltip>
      <PopoverContent side="right" align="end" sideOffset={12} className="w-[min(25rem,calc(100vw-5rem))] gap-0 p-0">
        <header className="border-b-2 border-dashed border-blueprint/25 p-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="font-heading text-xs tracking-[0.08em] text-primary uppercase">Complete your STL Quest</p>
              <h2 className="mt-1 font-heading text-xl">Learn by doing</h2>
            </div>
            <span className="shrink-0 rounded-full bg-primary/15 px-2.5 py-1 font-mono text-xs font-semibold text-primary">
              {points} XP
            </span>
          </div>
          <div className="mt-3 h-2 overflow-hidden rounded-full bg-muted">
            <div
              className="h-full rounded-full bg-primary transition-[width]"
              style={{ width: `${totalPoints ? (points / totalPoints) * 100 : 0}%` }}
            />
          </div>
          <p className="mt-2 text-xs text-muted-foreground">
            {resolvedCount} of {applicable.length} quests resolved · {totalPoints} XP available
          </p>
        </header>
        <div className="max-h-[min(32rem,var(--available-height))] overflow-y-auto p-2">
          {applicable.map((task) => {
            const completed = data?.completedTasks.includes(task.id) ?? false
            const skipped = data?.skippedTasks.includes(task.id) ?? false
            const newQuest = !!data?.celebratedTasks.length && !data.celebratedTasks.includes(task.id)
            return (
              <div key={task.id} className="group flex items-center gap-2 rounded-lg p-1 hover:bg-muted/60">
                <button
                  type="button"
                  className="flex min-w-0 flex-1 items-center gap-3 rounded-md p-2 text-left"
                  onClick={() => launch(task)}
                >
                  {completed ? (
                    <Check className="size-5 shrink-0 text-primary" />
                  ) : skipped ? (
                    <Circle className="size-5 shrink-0 text-muted-foreground/50" />
                  ) : (
                    <Flag className="size-5 shrink-0 text-primary" />
                  )}
                  <span className="min-w-0 flex-1">
                    <span className={cn('block text-sm font-medium', skipped && 'text-muted-foreground line-through')}>{task.title}</span>
                    <span className="block text-xs text-muted-foreground">
                      {completed ? 'Complete' : skipped ? 'Skipped' : `${newQuest ? 'New · ' : ''}${onboardingTaskPoints[task.id]} XP`}
                    </span>
                  </span>
                </button>
                {skipped ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    disabled={busy}
                    aria-label={`Restore ${task.title}`}
                    onClick={() => updateProgress({ operation: 'restore', task: task.id })}
                  >
                    <RotateCcw />
                  </Button>
                ) : !completed ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="text-xs text-muted-foreground"
                    aria-label={`Skip ${task.title}`}
                    disabled={busy}
                    onClick={() => updateProgress({ operation: 'skip', task: task.id })}
                  >
                    Not for me
                  </Button>
                ) : null}
              </div>
            )
          })}
        </div>
      </PopoverContent>
    </Popover>
  )
}

function QuestTooltip({ step, tooltipProps }: TooltipRenderProps) {
  const task = (step.data as StepData).task
  return (
    <section
      {...tooltipProps}
      aria-label="STL Quest"
      className="pointer-events-none w-[min(23rem,calc(100vw-2rem))] select-none rounded-xl border-2 border-blueprint bg-background p-4 text-foreground shadow-xl"
    >
      <div className="flex items-center justify-between gap-3 font-heading text-xs tracking-[0.08em] text-primary uppercase">
        <span>STL Quest</span>
        <span>+{onboardingTaskPoints[task.id]} XP</span>
      </div>
      <h2 className="mt-1 font-heading text-xl">{step.title}</h2>
      <p className="mt-3 text-sm leading-relaxed text-muted-foreground">{step.content}</p>
      <p className="mt-2 text-xs leading-relaxed text-muted-foreground">{task.hint}</p>
      <p className="mt-3 border-t border-dashed border-border pt-3 text-sm font-medium">Complete this action whenever you’re ready.</p>
    </section>
  )
}

function QuestCelebration({ points }: { points: number }) {
  return (
    <output className="quest-celebration pointer-events-none fixed inset-0 z-[100] grid place-items-center" aria-live="polite">
      <div className="rounded-2xl border-2 border-blueprint bg-background px-8 py-6 text-center shadow-2xl">
        <Sparkles className="mx-auto size-8 text-primary" />
        <p className="mt-2 font-heading text-2xl">STL Quest complete!</p>
        <p className="mt-1 text-sm text-muted-foreground">You earned {points} XP.</p>
      </div>
      <div className="quest-confetti" aria-hidden="true">
        {Array.from({ length: 24 }, (_, index) => (
          <i
            key={index}
            style={
              {
                '--confetti-delay': `${index * 45}ms`,
                '--confetti-drift': `${((index % 5) - 2) * 3}rem`,
                '--confetti-left': `${(index + 1) * 4}%`,
              } as React.CSSProperties
            }
          />
        ))}
      </div>
    </output>
  )
}

function pageFromPath(pathname: string): TourPage | undefined {
  if (pathname === '/') return 'board'
  if (pathname === '/settings/printers') return 'printers'
  if (pathname === '/settings/storage') return 'storage'
  return undefined
}

function sameTasks(left: Set<OnboardingTaskId>, right: Set<OnboardingTaskId>) {
  return left.size === right.size && [...left].every((task) => right.has(task))
}
