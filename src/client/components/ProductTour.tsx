import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { usePostHog } from '@posthog/react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useLocation } from '@tanstack/react-router'
import { useServerFn } from '@tanstack/react-start'
import { EVENTS, Joyride, type EventData, type Step, type TooltipRenderProps } from 'react-joyride'
import { onboardingTaskIds, type OnboardingTaskId } from '../../core/onboarding'
import { updateOnboardingProgress } from '../../server/fns'
import { onboardingQuery } from '../queries'
import { PRODUCT_TOUR_EVENT, PRODUCT_TOUR_ID, PRODUCT_TOUR_PROGRESS_EVENT } from '../productTour'

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

type StepData = {
  task: Task
}

const tasks: Task[] = [
  {
    id: 'upload',
    title: 'Add your first print',
    description: 'Add one or several STL files here when you are ready to put work into the queue.',
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
    title: 'More actions live on each print',
    description: 'Right-click a print card to move, group, select, or delete it.',
    hint: 'On a touchscreen, press and hold the card.',
    target: 'request-card',
    placement: 'right',
    admin: true,
    page: 'board',
  },
  {
    id: 'sort',
    title: 'Choose how the queue is sorted',
    description: 'Sort by requester priority, submission time, name, or recent activity.',
    hint: 'Sorting changes your view, not the underlying workflow.',
    target: 'sort',
    placement: 'bottom-end',
    page: 'board',
  },
  {
    id: 'filter',
    title: 'Focus the board with filters',
    description: 'Narrow the queue by print type, requester, dates, files, and more.',
    hint: 'Filtered views are reflected in the URL, so you can share them.',
    target: 'filters',
    placement: 'bottom-end',
    page: 'board',
  },
  {
    id: 'printers',
    title: 'Add your printer fleet',
    description: 'Printer profiles help match requests to compatible machines.',
    hint: 'Add a preset or enter a custom printer here.',
    target: 'printers',
    placement: 'top',
    admin: true,
    page: 'printers',
  },
  {
    id: 'storage',
    title: 'Know where models are stored',
    description: 'This page shows the active storage provider and the options for moving models later.',
    hint: 'The guide never changes your storage configuration.',
    target: 'storage',
    placement: 'top',
    admin: true,
    page: 'storage',
  },
]

export function ProductTour({ isAdmin }: { isAdmin: boolean }) {
  const location = useLocation()
  const posthog = usePostHog()
  const queryClient = useQueryClient()
  const callUpdate = useServerFn(updateOnboardingProgress)
  const { data } = useQuery(onboardingQuery())
  const page = pageFromPath(location.pathname)
  const available = useMemo(() => tasks.filter((task) => task.page === page && (!task.admin || isAdmin)), [isAdmin, page])
  const pending = useMemo(() => available.filter((task) => !data?.completedTasks.includes(task.id)), [available, data?.completedTasks])
  const [targets, setTargets] = useState<Set<OnboardingTaskId>>(new Set())
  const replaying = useRef(false)

  const mutation = useMutation({
    mutationFn: (input: Parameters<typeof callUpdate>[0]) => callUpdate(input),
    onSuccess: (progress) => {
      queryClient.setQueryData(onboardingQuery().queryKey, progress)
    },
  })

  const updateProgress = useCallback(
    (operation: Parameters<typeof callUpdate>[0]['data']) => mutation.mutate({ data: operation }),
    [mutation],
  )

  useEffect(() => {
    if (!page) return
    const refresh = () => {
      const found = new Set(pending.filter((task) => document.querySelector(`[data-onboarding="${task.target}"]`)).map((task) => task.id))
      setTargets((current) => (sameTasks(current, found) ? current : found))
    }
    refresh()
    const observer = new MutationObserver(refresh)
    observer.observe(document.body, { childList: true, subtree: true })
    return () => observer.disconnect()
  }, [page, pending])

  useEffect(() => {
    const replay = () => {
      replaying.current = true
      posthog.capture('product_tour_started', { tour_id: PRODUCT_TOUR_ID, page: 'board', source: 'restart' })
      updateProgress({ operation: 'restart', tasks: [...onboardingTaskIds] })
    }
    const complete = (event: Event) => {
      const task = (event as CustomEvent<OnboardingTaskId>).detail
      if (data?.completedTasks.includes(task)) return
      updateProgress({ operation: 'complete', task })
      posthog.capture('product_tour_task_completed', { tour_id: PRODUCT_TOUR_ID, task, source: 'interaction' })
    }
    window.addEventListener(PRODUCT_TOUR_EVENT, replay)
    window.addEventListener(PRODUCT_TOUR_PROGRESS_EVENT, complete)
    return () => {
      window.removeEventListener(PRODUCT_TOUR_EVENT, replay)
      window.removeEventListener(PRODUCT_TOUR_PROGRESS_EVENT, complete)
    }
  }, [data?.completedTasks, page, posthog, updateProgress])

  const visible = useMemo(() => pending.filter((task) => targets.has(task.id)), [pending, targets])
  const steps = useMemo<Step[]>(
    () =>
      visible.map((task) => ({
        id: task.id,
        target: `[data-onboarding="${task.target}"]`,
        title: task.title,
        content: task.description,
        placement: task.placement,
        data: { task } satisfies StepData,
      })),
    [visible],
  )
  const snoozed = (data?.snoozedUntil ?? 0) > Date.now()
  const run = !!data && !snoozed && steps.length > 0

  useEffect(() => {
    const target = steps[0]?.target
    if (!run || typeof target !== 'string') return
    const element = document.querySelector(target)
    element?.setAttribute('data-onboarding-active', 'true')
    return () => element?.removeAttribute('data-onboarding-active')
  }, [run, steps])

  const onEvent = useCallback(
    (event: EventData) => {
      const task = (event.step.data as StepData).task
      if (event.type === EVENTS.TOUR_START && !replaying.current) {
        posthog.capture('product_tour_started', { tour_id: PRODUCT_TOUR_ID, page })
      }
      if (event.type === EVENTS.TOUR_START) replaying.current = false
      if (event.type === EVENTS.TOOLTIP) {
        posthog.capture('product_tour_task_viewed', { tour_id: PRODUCT_TOUR_ID, task: task.id })
      }
    },
    [page, posthog],
  )

  if (!run) return null

  return (
    <Joyride
      key={`${page}:${steps.map((step) => step.id).join(':')}`}
      run
      steps={steps}
      onEvent={onEvent}
      tooltipComponent={TourTooltip}
      options={{
        blockTargetInteraction: false,
        buttons: [],
        disableFocusTrap: true,
        dismissKeyAction: false,
        hideOverlay: true,
        overlayClickAction: false,
        showProgress: true,
        skipBeacon: true,
        spotlightPadding: 6,
        spotlightRadius: 8,
        targetWaitTimeout: 2_000,
        zIndex: 40,
      }}
    />
  )
}

function TourTooltip({ index, size, step, tooltipProps }: TooltipRenderProps) {
  return (
    <section
      {...tooltipProps}
      aria-label="Getting started"
      className="pointer-events-none w-[min(23rem,calc(100vw-2rem))] select-none rounded-xl border-2 border-blueprint bg-background p-4 text-foreground shadow-xl"
    >
      <div className="font-heading text-xs tracking-[0.08em] text-muted-foreground uppercase">
        Getting started · {index + 1} of {size}
      </div>
      <h2 className="mt-1 font-heading text-xl">{step.title}</h2>
      <p className="mt-3 text-sm leading-relaxed text-muted-foreground">{step.content}</p>
      <p className="mt-2 text-xs leading-relaxed text-muted-foreground">{(step.data as StepData).task.hint}</p>
      <p className="mt-3 border-t border-dashed border-border pt-3 text-sm font-medium">Use it whenever you’re ready.</p>
    </section>
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

export const productTourTaskIds = onboardingTaskIds
