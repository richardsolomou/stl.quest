import type { StatusId } from '../../core/workflow'

export function StatusDot({ status }: { status: StatusId }) {
  return <span aria-hidden="true" data-stage={status} className="size-2.5 shrink-0 rounded-[2px] bg-(--stage)" />
}
