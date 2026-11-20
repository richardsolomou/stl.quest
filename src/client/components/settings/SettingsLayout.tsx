import { Children, useId, type ComponentProps, type ReactNode } from 'react'
import { cn } from '@/lib/utils'
import { AutosaveScope } from '../../useAutosave'
import { PageAutosaveStatus } from '../AutosaveStatus'

/** A page of the settings hub or a tool, whose autosaved forms report to the status in its header. */
export function SettingsPage({ className, ...props }: ComponentProps<'div'>) {
  return (
    <AutosaveScope>
      <div
        data-slot="settings-page"
        className={cn(
          'flex min-w-0 flex-col gap-8 [&>[data-slot=settings-section]+[data-slot=settings-section]]:border-t [&>[data-slot=settings-section]+[data-slot=settings-section]]:border-border [&>[data-slot=settings-section]+[data-slot=settings-section]]:pt-8',
          className,
        )}
        {...props}
      />
    </AutosaveScope>
  )
}

/**
 * The top of every page outside the board: the page's name, what it is for, whether its edits are saved, and the
 * actions that act on the whole page.
 */
export function PageHeader({
  title,
  description,
  actions,
  children,
}: {
  title: string
  description?: ReactNode
  actions?: ReactNode
  children?: ReactNode
}) {
  return (
    <header data-slot="page-header" className="flex flex-wrap items-end gap-x-6 gap-y-3 border-b border-border pb-5">
      <div className="flex min-w-0 flex-[1_1_20rem] flex-col gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="font-heading text-3xl leading-none font-extrabold tracking-tight text-foreground uppercase">{title}</h1>
          {children}
        </div>
        {description && <p className="max-w-3xl text-sm leading-relaxed text-muted-foreground">{description}</p>}
      </div>
      <div className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-2">
        <PageAutosaveStatus />
        {actions}
      </div>
    </header>
  )
}

/**
 * A working panel as a docket, such as the calculator's job and quote: an ink bar across the top, the title inside the
 * panel, and a dashed tear line between what the panel is for and its contents.
 */
export function Docket({
  title,
  description,
  className,
  children,
  ...props
}: ComponentProps<'fieldset'> & { title?: string; description?: ReactNode }) {
  return (
    <fieldset
      data-slot="docket"
      className={cn(
        'relative m-0 flex min-w-0 flex-col gap-4 overflow-hidden rounded-lg border border-border bg-card px-4 pt-6 pb-5 sm:px-5',
        className,
      )}
      {...props}
    >
      <span aria-hidden="true" className="absolute inset-x-0 top-0 h-1.5 bg-shell" />
      {title && (
        <legend className="float-left font-heading text-lg leading-none font-extrabold tracking-[0.01em] uppercase">{title}</legend>
      )}
      {description && <p className="-mt-2 max-w-3xl text-sm leading-relaxed text-muted-foreground">{description}</p>}
      {(title || description) && <hr aria-hidden="true" className="m-0 border-0 border-t border-dashed border-foreground/25" />}
      {children}
    </fieldset>
  )
}

/**
 * One group of settings as a line of a spec sheet: on wide screens its name and purpose sit in a margin column beside a
 * plain panel of fields, and groups are ruled off from each other; an untitled group's panel still sits in the field
 * column. Stacked groups, such as full-width tables, keep the heading above the panel, with the group's own add action
 * at its right. Danger groups turn the heading and panel fault red.
 */
export function SettingsSection({
  title,
  description,
  action,
  tone = 'default',
  layout = 'aside',
  className,
  children,
  ...props
}: ComponentProps<'fieldset'> & {
  title?: string
  description?: ReactNode
  action?: ReactNode
  tone?: 'default' | 'danger'
  layout?: 'aside' | 'stacked'
}) {
  const danger = tone === 'danger'
  const aside = layout === 'aside'
  const titleId = useId()
  return (
    // The title sits in the margin column rather than as the fieldset's own legend, so it names the group by reference.
    <fieldset
      data-slot="settings-section"
      data-tone={tone}
      aria-labelledby={title ? titleId : undefined}
      className={cn('m-0 grid min-w-0 gap-x-10 gap-y-3 border-0 p-0', aside && 'lg:grid-cols-[minmax(0,15rem)_minmax(0,1fr)]')}
      {...props}
    >
      {(title || description || action) && (
        <div className={cn('flex min-w-0 items-start gap-x-4 gap-y-2', aside && 'lg:pt-1')}>
          <div className="flex min-w-0 flex-1 flex-col gap-1.5">
            {title && (
              <div
                id={titleId}
                className={cn(
                  'w-full font-heading text-base leading-tight font-bold tracking-[0.01em] uppercase',
                  danger ? 'text-destructive' : 'text-foreground',
                )}
              >
                {title}
              </div>
            )}
            {description && <p className="max-w-3xl text-sm leading-relaxed text-muted-foreground">{description}</p>}
          </div>
          {action && <div className="shrink-0">{action}</div>}
        </div>
      )}
      {Children.toArray(children).length > 0 && (
        <div
          className={cn(
            'flex min-w-0 flex-col gap-4 rounded-lg border p-4 sm:p-5',
            danger ? 'border-destructive/40 bg-card' : 'border-border bg-card',
            aside && 'lg:col-start-2 lg:self-start',
            className,
          )}
        >
          {children}
        </div>
      )}
    </fieldset>
  )
}

// The first column takes the width the other columns leave and truncates; columns hide themselves in narrow tables through `meta.className`.
export function SettingsTableSection(props: Omit<ComponentProps<typeof SettingsSection>, 'className' | 'layout'>) {
  return (
    <SettingsSection
      layout="stacked"
      className="overflow-hidden p-0 sm:p-0 [&_td:first-child]:w-full [&_td:first-child]:max-w-0 max-sm:[&_td]:px-1 max-sm:[&_th]:px-1"
      {...props}
    />
  )
}

export function SettingsActions({ className, ...props }: ComponentProps<'div'>) {
  return <div data-slot="settings-actions" className={cn('flex flex-wrap items-center gap-2', className)} {...props} />
}
