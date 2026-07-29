import { formatBytes } from '../../../core/format'
import { storagePlans, type StoragePlan } from '../../../core/plans'
import { subscriptionState, type SubscriptionFields } from '../../../core/subscription'

const day = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })

/**
 * What the plan section says about the subscription. Kept apart from the component so every state
 * is covered, including the ones no test environment can reach without a real Stripe subscription.
 */
export function planSummary(subscription: SubscriptionFields | undefined, plan: StoragePlan): string {
  const price = storagePlans[plan].monthlyPrice
  const state = subscriptionState(subscription)
  const on = (value?: Date) => (value ? day.format(new Date(value)) : undefined)
  switch (state.kind) {
    case 'active':
      return on(state.renewsAt) ? `Renews ${on(state.renewsAt)} for $${price}.` : `Your ${storagePlans[plan].name} plan is active.`
    case 'trialing':
      return on(state.trialEndsAt) ? `Trial ends ${on(state.trialEndsAt)}, then $${price} a month.` : 'Your trial is running.'
    case 'ending':
      return on(state.endsAt)
        ? `Ends ${on(state.endsAt)}, then your storage drops to ${formatBytes(storagePlans.free.quotaBytes)}.`
        : 'Your plan is set to end.'
    case 'pastDue':
      return 'The last payment failed. Update your payment details to keep this plan.'
    case 'inactive':
      return 'This plan is no longer active.'
    default:
      return `The Free plan includes ${formatBytes(storagePlans.free.quotaBytes)} of managed storage.`
  }
}

export function includedStorageOnboardingCopy(plan: StoragePlan): string {
  const planName = plan === 'free' ? 'Your Free plan' : 'Your plan'
  return `Hosted by STL Quest. ${planName} includes ${formatBytes(storagePlans[plan].quotaBytes)} total for models, previews, and thumbnails, shared across all your workspaces. Nothing else to configure.`
}
