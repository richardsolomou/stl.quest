import { useState } from 'react'
import { STATUS_LABELS, type Status } from '../../convex/statuses'
import { useEscape } from '../lib/useEscape'

export function MoveDialog({
  jobName,
  to,
  max,
  onConfirm,
  onCancel,
}: {
  jobName: string
  to: Status
  max: number
  onConfirm: (count: number) => void
  onCancel: () => void
}) {
  const [count, setCount] = useState(String(max))
  useEscape(onCancel)

  return (
    <div className="overlay" onClick={(e) => e.target === e.currentTarget && onCancel()}>
      <form
        className="dialog dialog-small"
        onSubmit={(e) => {
          e.preventDefault()
          onConfirm(Math.min(max, Math.max(1, Math.round(Number(count) || 1))))
        }}
      >
        <h2>Move copies</h2>
        <p className="move-copy">
          How many copies of “{jobName}” to {STATUS_LABELS[to]}?
        </p>
        <div className="field">
          <label htmlFor="move-count">Copies (of {max})</label>
          <input
            id="move-count"
            type="number"
            inputMode="numeric"
            min={1}
            max={max}
            value={count}
            onChange={(e) => setCount(e.target.value)}
            autoFocus
          />
        </div>
        <div className="dialog-actions">
          <button type="button" className="btn" onClick={onCancel}>
            Cancel
          </button>
          <button type="submit" className="btn btn-primary">
            Move
          </button>
        </div>
      </form>
    </div>
  )
}
