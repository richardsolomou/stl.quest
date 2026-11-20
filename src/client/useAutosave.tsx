import { createContext, useContext, useEffect, useId, useMemo, useRef, useState, type FocusEvent, type ReactNode } from 'react'
import { combineAutosaveStatus, createAutosaver, type AutosaveState, type AutosaveStatus } from './autosave'

type ScopeEntry = { status: AutosaveStatus; retry: () => void }
type Scope = { report: (id: string, entry?: ScopeEntry) => void }
export type ScopeStatus = { status: AutosaveStatus; retry: () => void }

const ScopeContext = createContext<Scope | undefined>(undefined)
const StatusContext = createContext<ScopeStatus>({ status: 'idle', retry: () => undefined })

/** Gathers every autosaved form inside it into one status, which the page header shows. */
export function AutosaveScope({ children }: { children: ReactNode }) {
  const [entries, setEntries] = useState<Record<string, ScopeEntry>>({})
  const scope = useMemo<Scope>(
    () => ({
      report: (id, entry) =>
        setEntries((current) => {
          if (entry ? current[id]?.status === entry.status : !(id in current)) return current
          const { [id]: _removed, ...rest } = current
          return entry ? { ...rest, [id]: entry } : rest
        }),
    }),
    [],
  )
  const status = useMemo<ScopeStatus>(() => {
    const all = Object.values(entries)
    return {
      status: combineAutosaveStatus(all.map((entry) => entry.status)),
      retry: () => all.filter((entry) => entry.status === 'error').forEach((entry) => entry.retry()),
    }
  }, [entries])
  return (
    <ScopeContext value={scope}>
      <StatusContext value={status}>{children}</StatusContext>
    </ScopeContext>
  )
}

export function useAutosaveScopeStatus() {
  return useContext(StatusContext)
}

/**
 * Saves `value` a moment after it stops changing, and at once on `flush` (blur, closing a dialog) or unmount. An
 * invalid value is never sent; the field shows why and the last valid value stays stored. Reports to the nearest
 * `AutosaveScope`, and asks before the tab closes while a change is unsaved.
 */
export function useAutosave<T>({
  value,
  initial = value,
  valid = true,
  save,
}: {
  value: T
  /** What is stored when the form opens, if not `value` itself. */
  initial?: T
  valid?: boolean
  save: (value: T) => Promise<unknown>
}) {
  const [state, setState] = useState<AutosaveState>({ status: 'idle' })
  const latestSave = useRef(save)
  latestSave.current = save
  const [saver] = useState(() => createAutosaver({ initial, save: (next: T) => latestSave.current(next), onState: setState }))
  useEffect(() => saver.change(value, valid), [saver, value, valid])
  useEffect(() => () => void saver.flush(), [saver])

  const unsaved = state.status === 'pending' || state.status === 'saving' || state.status === 'error'
  useEffect(() => {
    if (!unsaved) return
    const warn = (event: BeforeUnloadEvent) => event.preventDefault()
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [unsaved])

  const scope = useContext(ScopeContext)
  const id = useId()
  const retry = saver.flush
  useEffect(() => scope?.report(id, { status: state.status, retry }), [scope, id, state.status, retry])
  useEffect(() => () => scope?.report(id), [scope, id])

  return useMemo(() => ({ ...state, flush: saver.flush, retry, adopt: saver.adopt }), [state, saver, retry])
}

export type Autosave = ReturnType<typeof useAutosave>

/**
 * A draft of `stored` that saves itself, and follows `stored` when it changes elsewhere (a realtime refetch, another
 * admin) unless the draft holds an edit that is not saved yet or focus is inside `bind`, so a field being typed in is
 * never replaced. Leaving `bind` saves at once.
 */
export function useAutosavedDraft<T>(stored: T, { save, valid }: { save: (value: T) => Promise<unknown>; valid?: (value: T) => boolean }) {
  const [draft, setDraft] = useState(stored)
  const [editing, setEditing] = useState(false)
  const autosave = useAutosave({ value: draft, valid: valid?.(draft) ?? true, save })
  const { adopt, flush } = autosave
  useEffect(() => {
    if (!editing && adopt(stored)) setDraft((current) => (JSON.stringify(current) === JSON.stringify(stored) ? current : stored))
  }, [stored, adopt, editing])
  const bind = useMemo(
    () => ({
      onFocus: () => setEditing(true),
      onBlur: (event: FocusEvent<HTMLElement>) => {
        if (event.currentTarget.contains(event.relatedTarget)) return
        setEditing(false)
        void flush()
      },
    }),
    [flush],
  )
  return { draft, setDraft, autosave, bind }
}

export type FocusBinding = ReturnType<typeof useAutosavedDraft>['bind']
