import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { usePostHog } from '@posthog/react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useLocation, useNavigate } from '@tanstack/react-router'
import { useServerFn } from '@tanstack/react-start'
import confetti from 'canvas-confetti'
import { Check, Circle, Flag, RotateCcw, X } from 'lucide-react'
import { EVENTS, Joyride, type EventData, type Step, type TooltipRenderProps } from 'react-joyride'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import {
  applicableOnboardingQuests,
  availableOnboardingQuests,
  onboardingPoints,
  onboardingQuestVersion,
  onboardingSections,
  onboardingTaskIds,
  type OnboardingProgress,
  type OnboardingProgressOperation,
  type OnboardingQuest,
  type OnboardingTaskId,
} from '../../core/onboarding'
import { updateOnboardingProgress } from '../../server/fns'
import { onboardingQuery, requestsQuery } from '../queries'
import {
  PRODUCT_QUEST_EVENT,
  PRODUCT_QUEST_UI,
  PRODUCT_TOUR_ID,
  PRODUCT_TOUR_PROGRESS_EVENT,
  productTourPage,
  type ProductTourProgress,
} from '../productTour'
import { useWorkspaceSlug } from '../workspace'

type QuestStepData = { quest: OnboardingQuest; dismiss: () => void }

const focusedQuestKey = 'stlquest:focused-quest'
const announcedQuestsKey = 'stlquest:announced-quests'
type GuidanceSource = 'interaction' | 'quest_list'

export function ProductTour({ isAdmin }: { isAdmin: boolean }) {
  const location = useLocation()
  const navigate = useNavigate()
  const workspaceSlug = useWorkspaceSlug()
  const posthog = usePostHog()
  const queryClient = useQueryClient()
  const callUpdate = useServerFn(updateOnboardingProgress)
  const { data } = useQuery(onboardingQuery(workspaceSlug))
  const { data: requests } = useQuery(requestsQuery(workspaceSlug))
  const page = productTourPage(location.pathname)
  const applicable = useMemo(() => applicableOnboardingQuests(isAdmin), [isAdmin])
  const visible = useMemo(
    () => (data ? availableOnboardingQuests(applicable, data, (requests?.requests.length ?? 0) > 0) : []),
    [applicable, data, requests?.requests.length],
  )
  const [open, setOpen] = useState(false)
  const [reviewing, setReviewing] = useState(false)
  const [focusedTask, setFocusedTask] = useState<OnboardingTaskId | undefined>(() => {
    if (typeof window === 'undefined') return undefined
    const stored = sessionStorage.getItem(focusedQuestKey)
    return onboardingTaskIds.find((task) => task === stored)
  })
  const [targetAvailable, setTargetAvailable] = useState(false)
  const [celebrating, setCelebrating] = useState(false)
  const [newQuestAnnouncement, setNewQuestAnnouncement] = useState('')
  const viewedAt = useRef(new Map<OnboardingTaskId, number>())
  const acknowledgedTasks = useRef<Set<OnboardingTaskId> | undefined>(undefined)

  const mutation = useMutation({
    mutationFn: (input: Parameters<typeof callUpdate>[0]) => callUpdate(input),
    onSuccess: (progress) => queryClient.setQueryData(onboardingQuery(workspaceSlug).queryKey, progress),
  })
  const updateProgress = useCallback(
    (operation: Parameters<typeof callUpdate>[0]['data']) => {
      mutation.mutate({ data: operation })
      if (operation.operation === 'skip' || operation.operation === 'restore') {
        posthog.capture(`product_tour_task_${operation.operation === 'skip' ? 'skipped' : 'restored'}`, {
          tour_id: PRODUCT_TOUR_ID,
          task: operation.task,
          source: 'quest_list',
        })
      }
    },
    [mutation, posthog],
  )

  useEffect(() => {
    const showQuest = () => setOpen(true)
    window.addEventListener(PRODUCT_QUEST_EVENT, showQuest)
    return () => window.removeEventListener(PRODUCT_QUEST_EVENT, showQuest)
  }, [])

  const candidate = focusedTask && visible.find((quest) => quest.id === focusedTask && PRODUCT_QUEST_UI[quest.id].page === page)

  useEffect(() => {
    if (!candidate) {
      setTargetAvailable(false)
      return
    }
    const selector = `[data-onboarding="${PRODUCT_QUEST_UI[candidate.id].target}"]`
    const refresh = () => {
      setTargetAvailable(!!document.querySelector(selector))
    }
    refresh()
    const observer = new MutationObserver(refresh)
    observer.observe(document.body, { childList: true, subtree: true })
    return () => observer.disconnect()
  }, [candidate])

  useEffect(() => {
    if (data && !acknowledgedTasks.current) acknowledgedTasks.current = new Set(data.completedTasks)
  }, [data])

  useEffect(() => {
    const complete = (event: Event) => {
      const { task } = (event as CustomEvent<ProductTourProgress>).detail
      const source: GuidanceSource = focusedTask === task ? 'quest_list' : 'interaction'
      if (focusedTask === task) {
        setFocusedTask(undefined)
        sessionStorage.removeItem(focusedQuestKey)
      }
      const acknowledged = (acknowledgedTasks.current ??= new Set(data?.completedTasks))
      if (acknowledged.has(task)) return
      acknowledged.add(task)
      if (!data?.completedTasks.includes(task)) updateProgress({ operation: 'complete', task })
      const resolved = new Set([...(data?.completedTasks ?? []), ...(data?.skippedTasks ?? []), task])
      const completesOnboarding = applicable.every((quest) => resolved.has(quest.id))
      if (source === 'interaction' && !completesOnboarding) {
        const quest = applicable.find((item) => item.id === task)
        if (quest) {
          toast.success(`${quest.title} complete`, {
            description: `+${quest.points} XP earned`,
            action: { label: 'View onboarding', onClick: () => setOpen(true) },
          })
        }
      }
      const startedAt = viewedAt.current.get(task)
      posthog.capture('product_tour_task_completed', {
        tour_id: PRODUCT_TOUR_ID,
        task,
        source,
        ...(startedAt ? { duration_seconds: Math.min(86_400, Math.max(0, Math.round((Date.now() - startedAt) / 1_000))) } : {}),
      })
      viewedAt.current.delete(task)
    }
    window.addEventListener(PRODUCT_TOUR_PROGRESS_EVENT, complete)
    return () => window.removeEventListener(PRODUCT_TOUR_PROGRESS_EVENT, complete)
  }, [applicable, data?.completedTasks, data?.skippedTasks, focusedTask, posthog, updateProgress])

  useEffect(() => {
    if (!data || mutation.isPending || celebrating) return
    const resolved = new Set([...data.completedTasks, ...data.skippedTasks])
    if (!applicable.every((quest) => resolved.has(quest.id))) return
    const newTasks = applicable.filter((quest) => !data.celebratedTasks.includes(quest.id))
    if (!newTasks.length) return
    setCelebrating(true)
    updateProgress({ operation: 'celebrate', tasks: applicable.map((quest) => quest.id) })
    void confetti({
      particleCount: 120,
      spread: 100,
      origin: { y: 0.7 },
      colors: ['#f2ad3d', '#4fa8b8', '#d95d4f'],
      disableForReducedMotion: true,
      zIndex: 100,
    })
    posthog.capture('product_tour_completed', {
      tour_id: PRODUCT_TOUR_ID,
      completed: applicable.filter((quest) => data.completedTasks.includes(quest.id)).length,
      skipped: applicable.filter((quest) => data.skippedTasks.includes(quest.id)).length,
    })
  }, [applicable, celebrating, data, mutation.isPending, posthog, updateProgress])

  useEffect(() => {
    if (!celebrating) return
    const timeout = window.setTimeout(() => setCelebrating(false), 3_500)
    return () => window.clearTimeout(timeout)
  }, [celebrating])

  const active = targetAvailable ? candidate : undefined
  const step = useMemo<Step | undefined>(() => {
    if (!active) return undefined
    const ui = PRODUCT_QUEST_UI[active.id]
    return {
      id: active.id,
      target: `[data-onboarding="${ui.target}"]`,
      title: active.title,
      content: active.description,
      placement: ui.placement,
      data: {
        quest: active,
        dismiss: () => {
          posthog.capture('product_tour_paused', { tour_id: PRODUCT_TOUR_ID, task: active.id, source: 'quest_list' })
          setFocusedTask(undefined)
          sessionStorage.removeItem(focusedQuestKey)
        },
      } satisfies QuestStepData,
    }
  }, [active, posthog])

  useEffect(() => {
    const element = !open && active ? document.querySelector(`[data-onboarding="${PRODUCT_QUEST_UI[active.id].target}"]`) : undefined
    element?.setAttribute('data-onboarding-active', 'true')
    return () => element?.removeAttribute('data-onboarding-active')
  }, [active, open])

  const launch = async (quest: OnboardingQuest) => {
    setOpen(false)
    setFocusedTask(quest.id)
    sessionStorage.setItem(focusedQuestKey, quest.id)
    posthog.capture('product_tour_started', { tour_id: PRODUCT_TOUR_ID, task: quest.id, source: 'quest_list' })
    const ui = PRODUCT_QUEST_UI[quest.id]
    if (ui.page === 'board') await navigate({ to: '/' })
    else await navigate({ to: '/settings/$section', params: { section: ui.page === 'board-settings' ? 'board' : ui.page } })
  }

  const points = data
    ? onboardingPoints(
        data.completedTasks,
        applicable.map((quest) => quest.id),
      )
    : 0
  const totalPoints = applicable.reduce((total, quest) => total + quest.points, 0)
  const resolvedCount = data
    ? applicable.filter((quest) => data.completedTasks.includes(quest.id) || data.skippedTasks.includes(quest.id)).length
    : 0
  const newCount = data?.celebratedTasks.length ? visible.filter((quest) => !data.celebratedTasks.includes(quest.id)).length : 0

  useEffect(() => {
    if (!newCount || !data) return
    const announced = announcedQuests()
    const newTasks = visible.filter((quest) => !data.celebratedTasks.includes(quest.id) && !announced.has(onboardingQuestVersion(quest)))
    if (!newTasks.length) return
    setNewQuestAnnouncement(`${newTasks.length} new STL Quest${newTasks.length === 1 ? '' : 's'} available.`)
    for (const quest of newTasks) announced.add(onboardingQuestVersion(quest))
    localStorage.setItem(announcedQuestsKey, JSON.stringify([...announced]))
  }, [data, newCount, visible])

  return (
    <>
      <QuestPopover
        applicable={applicable}
        visible={visible}
        data={data}
        open={open}
        setOpen={(next) => {
          setOpen(next)
          if (!next) setReviewing(false)
        }}
        reviewing={reviewing}
        setReviewing={setReviewing}
        points={points}
        totalPoints={totalPoints}
        resolvedCount={resolvedCount}
        newCount={newCount}
        activePrompt={!!active}
        busy={mutation.isPending}
        launch={launch}
        updateProgress={updateProgress}
      />
      {step && data && !open && (
        <Joyride
          key={`${page}:${step.id}`}
          run
          steps={[step]}
          loaderComponent={null}
          onEvent={(event: EventData) => {
            if (event.type === EVENTS.TOOLTIP) {
              posthog.capture('product_tour_task_viewed', {
                tour_id: PRODUCT_TOUR_ID,
                task: (event.step.data as QuestStepData).quest.id,
                source: 'quest_list',
              })
              viewedAt.current.set((event.step.data as QuestStepData).quest.id, Date.now())
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
      <output className="sr-only" aria-live="polite">
        {newQuestAnnouncement}
      </output>
    </>
  )
}

function QuestPopover({
  applicable,
  visible,
  data,
  open,
  setOpen,
  reviewing,
  setReviewing,
  points,
  totalPoints,
  resolvedCount,
  newCount,
  activePrompt,
  busy,
  launch,
  updateProgress,
}: {
  applicable: OnboardingQuest[]
  visible: OnboardingQuest[]
  data?: OnboardingProgress
  open: boolean
  setOpen: (open: boolean) => void
  reviewing: boolean
  setReviewing: (reviewing: boolean) => void
  points: number
  totalPoints: number
  resolvedCount: number
  newCount: number
  activePrompt: boolean
  busy: boolean
  launch: (quest: OnboardingQuest) => void
  updateProgress: (operation: OnboardingProgressOperation) => void
}) {
  const complete = resolvedCount === applicable.length
  const completed = data ? applicable.filter((quest) => data.completedTasks.includes(quest.id)).length : 0
  const skipped = data ? applicable.filter((quest) => data.skippedTasks.includes(quest.id)).length : 0
  const showList = !complete || reviewing
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
                    'fixed right-4 bottom-4 z-50 grid size-11 cursor-pointer place-items-center rounded-full border-2 border-blueprint bg-background text-muted-foreground shadow-lg transition-colors hover:bg-muted hover:text-foreground',
                    !complete && 'text-primary',
                    activePrompt && 'ring-4 ring-primary/20',
                    complete && 'invisible pointer-events-none',
                  )}
                  aria-hidden={complete || undefined}
                  aria-label={`STL Quest, ${resolvedCount} of ${applicable.length} resolved, ${points} XP${newCount ? `, ${newCount} new` : ''}`}
                  tabIndex={complete ? -1 : undefined}
                />
              }
            />
          }
        >
          {complete ? <Check className="size-[18px]" /> : <Flag className="size-[18px]" />}
          {!complete && <span className="absolute top-0.5 right-0.5 size-2 rounded-full bg-primary ring-2 ring-background" />}
        </TooltipTrigger>
        <TooltipContent side="left">
          {complete ? 'STL Quest complete' : newCount ? `${newCount} new quests` : 'Complete your STL Quest'}
        </TooltipContent>
      </Tooltip>
      <PopoverContent side="top" align="end" sideOffset={10} className="w-[min(22rem,calc(100vw-2rem))] gap-0 p-0">
        <header className={cn('p-3', showList && 'border-b border-dashed border-blueprint/25')}>
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="font-heading text-xs tracking-[0.08em] text-primary uppercase">
                {complete ? 'STL Quest complete' : 'Complete your STL Quest'}
              </p>
              <h2 className="font-heading text-lg">{complete ? 'Ready for the next quest' : 'Learn by doing'}</h2>
            </div>
            <span className="shrink-0 rounded-full bg-primary/15 px-2.5 py-1 font-mono text-xs font-semibold text-primary">
              {points} XP
            </span>
          </div>
          <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted">
            <div
              className="h-full rounded-full bg-primary transition-[width]"
              style={{ width: `${applicable.length ? (resolvedCount / applicable.length) * 100 : 0}%` }}
            />
          </div>
          <p className="mt-1.5 text-xs text-muted-foreground">
            {resolvedCount} of {applicable.length} quests resolved · {points} of {totalPoints} XP earned
          </p>
          {complete && !reviewing && (
            <div className="mt-4 flex items-center justify-between gap-3 border-t border-dashed border-border pt-3">
              <span className="text-sm text-muted-foreground">
                {completed} completed · {skipped} skipped
              </span>
              <Button type="button" variant="outline" size="sm" onClick={() => setReviewing(true)}>
                Review quests
              </Button>
            </div>
          )}
        </header>
        {showList && (
          <div className="max-h-[min(28rem,var(--available-height))] overflow-y-auto p-1.5">
            {onboardingSections.map((section) => {
              const sectionQuests = visible.filter((quest) => quest.section === section.id)
              if (!sectionQuests.length) return null
              return (
                <section key={section.id} className="not-first:mt-1" aria-labelledby={`quest-section-${section.id}`}>
                  <h3
                    id={`quest-section-${section.id}`}
                    className="px-2.5 pt-1.5 pb-0.5 font-heading text-[11px] tracking-[0.08em] text-muted-foreground uppercase"
                  >
                    {section.title}
                  </h3>
                  {sectionQuests.map((quest) => (
                    <QuestRow key={quest.id} quest={quest} data={data} busy={busy} launch={launch} updateProgress={updateProgress} />
                  ))}
                </section>
              )
            })}
          </div>
        )}
      </PopoverContent>
    </Popover>
  )
}

function QuestRow({
  quest,
  data,
  busy,
  launch,
  updateProgress,
}: {
  quest: OnboardingQuest
  data?: OnboardingProgress
  busy: boolean
  launch: (quest: OnboardingQuest) => void
  updateProgress: (operation: OnboardingProgressOperation) => void
}) {
  const completed = data?.completedTasks.includes(quest.id) ?? false
  const skipped = data?.skippedTasks.includes(quest.id) ?? false
  const newQuest = !!data?.celebratedTasks.length && !data.celebratedTasks.includes(quest.id)
  return (
    <div className="group flex items-center gap-1 rounded-lg hover:bg-muted/60">
      <button
        type="button"
        className="flex min-w-0 flex-1 items-center gap-2 rounded-md px-2 py-1.5 text-left"
        onClick={() => launch(quest)}
      >
        {completed ? (
          <Check className="size-4 shrink-0 text-primary" />
        ) : skipped ? (
          <Circle className="size-4 shrink-0 text-muted-foreground/50" />
        ) : (
          <Flag className="size-4 shrink-0 text-primary" />
        )}
        <span className="min-w-0 flex-1">
          <span className={cn('block text-sm font-medium', (completed || skipped) && 'text-muted-foreground line-through')}>
            {quest.title}
          </span>
          <span className="block text-xs text-muted-foreground">
            {completed ? 'Complete · Review' : skipped ? 'Skipped' : `${newQuest ? 'New · ' : ''}${quest.points} XP`}
          </span>
        </span>
      </button>
      {skipped ? (
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          disabled={busy}
          aria-label={`Restore ${quest.title}`}
          onClick={() => updateProgress({ operation: 'restore', task: quest.id })}
        >
          <RotateCcw />
        </Button>
      ) : !completed ? (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="text-xs text-muted-foreground"
          aria-label={`Skip ${quest.title}`}
          disabled={busy}
          onClick={() => updateProgress({ operation: 'skip', task: quest.id })}
        >
          Not for me
        </Button>
      ) : null}
    </div>
  )
}

function QuestTooltip({ closeProps, step, tooltipProps }: TooltipRenderProps) {
  const { dismiss, quest } = step.data as QuestStepData
  return (
    <section
      {...tooltipProps}
      role="note"
      aria-live="polite"
      aria-label="STL Quest"
      className="pointer-events-none w-[min(19rem,calc(100vw-2rem))] select-none rounded-lg border-2 border-blueprint bg-background p-3 text-foreground shadow-xl"
    >
      <div className="flex items-center justify-between gap-3">
        <span className="font-heading text-xs tracking-[0.08em] text-primary uppercase">STL Quest · +{quest.points} XP</span>
        <Button
          {...closeProps}
          type="button"
          variant="ghost"
          size="icon-sm"
          className="pointer-events-auto -mt-2 -mr-2"
          aria-label="Close onboarding prompt"
          onClick={(event) => {
            closeProps.onClick(event)
            dismiss()
          }}
        >
          <X />
        </Button>
      </div>
      <h2 className="font-heading text-base">{step.title}</h2>
      <p className="mt-1 text-xs leading-snug text-muted-foreground">{step.content}</p>
    </section>
  )
}

function announcedQuests() {
  try {
    const stored: unknown = JSON.parse(localStorage.getItem(announcedQuestsKey) ?? '[]')
    return new Set(Array.isArray(stored) ? stored.filter((task): task is string => typeof task === 'string') : [])
  } catch {
    return new Set<string>()
  }
}
