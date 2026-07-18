import { BALANCED_PLANNING_WEIGHTS, type PlatePlanningStrategy } from '../core/planningStrategy'

const percentage = (weight: number) => `${Math.round(weight * 100)}%`

export const PLANNING_OPTIONS: { value: PlatePlanningStrategy; label: string; description: string }[] = [
  {
    value: 'balanced',
    label: 'Balanced',
    description: `Weight plate fill (${percentage(BALANCED_PLANNING_WEIGHTS.utilization)}), requester priority (${percentage(BALANCED_PLANNING_WEIGHTS.userPriority)}), and resin height compatibility (${percentage(BALANCED_PLANNING_WEIGHTS.heightCompatibility)} when applicable).`,
  },
  {
    value: 'user-priority',
    label: 'User priority',
    description: "Fill plates efficiently while working through every requester's personal queue as fairly as possible.",
  },
  {
    value: 'oldest-first',
    label: 'Oldest first',
    description: 'Fill plates efficiently while processing the longest-waiting requests first.',
  },
  {
    value: 'utilization',
    label: 'Maximum utilization',
    description: 'Choose the fewest, fullest plates even when that mixes requester priority or resin model heights.',
  },
  {
    value: 'height-first',
    label: 'Tallest first',
    description: 'Fill plates efficiently while starting with the tallest models and compatible resin height bands.',
  },
]
