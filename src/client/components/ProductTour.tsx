import { useEffect, useState } from 'react'
import { Check, ChevronRight, Grip, MousePointer2, Upload } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import {
  dismissProductTour,
  PRODUCT_TOUR_EVENT,
  PRODUCT_TOUR_PROGRESS_EVENT,
  productTourState,
  saveProductTourState,
  snoozeProductTour,
  type ProductTourTask,
} from '../productTour'

const tasks: {
  id: ProductTourTask
  title: string
  description: string
  hint: string
  icon: typeof Upload
  target: string
}[] = [
  {
    id: 'upload',
    title: 'Add your first print',
    description: 'Drag STL files anywhere onto the board, or choose them from your computer.',
    hint: 'You can drop several files at once.',
    icon: Upload,
    target: 'upload',
  },
  {
    id: 'move',
    title: 'Move work through the queue',
    description: 'Drag a print card from one column to another to update its stage.',
    hint: 'For multi-copy requests, choose how many copies to move.',
    icon: Grip,
    target: 'request-card',
  },
  {
    id: 'actions',
    title: 'Find more print actions',
    description: 'Right-click a print card to move, group, select, or delete it.',
    hint: 'On a touchscreen, press and hold the card.',
    icon: MousePointer2,
    target: 'request-card',
  },
]

export function ProductTour({ identityId }: { identityId: string }) {
  const [open, setOpen] = useState(false)
  const [completed, setCompleted] = useState<ProductTourTask[]>([])
  const [selected, setSelected] = useState<ProductTourTask>('upload')
  const current = tasks.find((task) => task.id === selected) ?? tasks[0]

  useEffect(() => {
    const initial = productTourState(identityId)
    setCompleted(initial.completed)
    setSelected(tasks.find((task) => !initial.completed.includes(task.id))?.id ?? 'upload')
    setOpen(initial.status === 'active')
    const replay = () => {
      setCompleted([])
      setSelected('upload')
      setOpen(true)
      saveProductTourState(identityId, { status: 'active', completed: [] })
    }
    const progress = (event: Event) => {
      if (!open) return
      const task = (event as CustomEvent<ProductTourTask>).detail
      setCompleted((existing) => {
        if (existing.includes(task)) return existing
        const next = [...existing, task]
        if (next.length === tasks.length) {
          dismissProductTour(identityId, next)
          setOpen(false)
          return next
        }
        saveProductTourState(identityId, { status: 'active', completed: next })
        const nextTask = tasks.find((item) => !next.includes(item.id))
        if (nextTask) setSelected(nextTask.id)
        return next
      })
    }
    window.addEventListener(PRODUCT_TOUR_EVENT, replay)
    window.addEventListener(PRODUCT_TOUR_PROGRESS_EVENT, progress)
    return () => {
      window.removeEventListener(PRODUCT_TOUR_EVENT, replay)
      window.removeEventListener(PRODUCT_TOUR_PROGRESS_EVENT, progress)
    }
  }, [identityId, open])

  useEffect(() => {
    if (!open) return
    const target = document.querySelector(`[data-tour="${current.target}"]`)
    target?.setAttribute('data-tour-active', 'true')
    return () => target?.removeAttribute('data-tour-active')
  }, [current.target, open])

  if (!open) return null

  const close = () => {
    dismissProductTour(identityId, completed)
    setOpen(false)
  }

  return (
    <section
      aria-label="Getting started"
      aria-live="polite"
      className="fixed right-4 bottom-20 z-30 w-[min(25rem,calc(100vw-2rem))] rounded-xl border-2 border-blueprint bg-background p-4 shadow-xl"
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
          onClick={() => {
            snoozeProductTour(identityId, completed)
            setOpen(false)
          }}
        >
          Remind me tomorrow
        </Button>
      </div>

      <>
        <div className="mt-4 flex flex-col gap-2">
          {tasks.map((task) => {
            const done = completed.includes(task.id)
            const active = selected === task.id
            const Icon = task.icon
            return (
              <div
                key={task.id}
                className={cn(
                  'rounded-lg border p-3 transition-colors',
                  active ? 'border-primary bg-primary/5' : 'border-border hover:bg-muted/50',
                )}
              >
                <button type="button" className="flex w-full items-center gap-3 text-left" onClick={() => setSelected(task.id)}>
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
                    {task.id === 'upload' && (
                      <Button
                        type="button"
                        size="sm"
                        className="mt-3"
                        onClick={() => {
                          document.querySelector<HTMLButtonElement>('[data-tour="upload"]')?.click()
                        }}
                      >
                        Choose files
                      </Button>
                    )}
                  </div>
                )}
              </div>
            )
          })}
        </div>
        <div className="mt-4 flex items-center justify-between gap-3">
          <span className="text-xs text-muted-foreground">
            {completed.length} of {tasks.length} complete
          </span>
          <Button type="button" variant="ghost" size="sm" onClick={close}>
            Skip guide
          </Button>
        </div>
      </>
    </section>
  )
}
