/**
 * What a subscription is currently doing, derived from the fields Stripe syncs through Better
 * Auth. The status alone is not enough: an active subscription set to cancel reads very
 * differently to one that renews, and both arrive as `status: 'active'`.
 */
export type SubscriptionState =
  | { kind: 'none' }
  | { kind: 'trialing'; trialEndsAt?: Date }
  | { kind: 'active'; renewsAt?: Date }
  | { kind: 'ending'; endsAt?: Date }
  | { kind: 'pastDue' }
  | { kind: 'inactive' }

export type SubscriptionFields = {
  status?: string | null
  cancelAtPeriodEnd?: boolean | null
  trialEnd?: Date | null
  periodEnd?: Date | null
  cancelAt?: Date | null
}

export function subscriptionState(subscription: SubscriptionFields | undefined): SubscriptionState {
  if (!subscription?.status) return { kind: 'none' }
  const { status, cancelAtPeriodEnd, trialEnd, periodEnd, cancelAt } = subscription
  if (status === 'past_due' || status === 'unpaid') return { kind: 'pastDue' }
  // A pending cancellation outranks the trial or period it is cancelling.
  if (cancelAtPeriodEnd) return { kind: 'ending', endsAt: cancelAt ?? trialEnd ?? periodEnd ?? undefined }
  if (status === 'trialing') return { kind: 'trialing', trialEndsAt: trialEnd ?? periodEnd ?? undefined }
  if (status === 'active') return { kind: 'active', renewsAt: periodEnd ?? undefined }
  return { kind: 'inactive' }
}

// A subscription only grants its plan while it is being honoured.
export const ACTIVE_SUBSCRIPTION_STATUSES = ['active', 'trialing'] as const
