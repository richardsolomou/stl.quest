import { formatBytes } from '../../../core/format'
import type { Locale, Messages } from '../../../core/i18n'
import { storagePlans, type StoragePlan } from '../../../core/plans'
import { subscriptionState, type SubscriptionFields } from '../../../core/subscription'

// English keeps day-month-year order.
const dayFormat = (locale: Locale) =>
  new Intl.DateTimeFormat(locale === 'en' ? 'en-GB' : locale, { day: 'numeric', month: 'long', year: 'numeric' })

/**
 * What the plan section says about the subscription. Kept apart from the component so every state
 * is covered, including the ones no test environment can reach without a real Stripe subscription.
 */
export function planSummary(subscription: SubscriptionFields | undefined, plan: StoragePlan, t: Messages, locale: Locale): string {
  const copy = t.settings.plan.summary
  const price = storagePlans[plan].monthlyPrice
  const state = subscriptionState(subscription)
  const day = dayFormat(locale)
  const on = (value?: Date) => (value ? day.format(new Date(value)) : undefined)
  switch (state.kind) {
    case 'active':
      return on(state.renewsAt) ? copy.renews(on(state.renewsAt)!, price) : copy.active(t.settings.plan.names[plan])
    case 'trialing':
      return on(state.trialEndsAt) ? copy.trialEnds(on(state.trialEndsAt)!, price) : copy.trialing
    case 'ending':
      return on(state.endsAt) ? copy.ends(on(state.endsAt)!, formatBytes(storagePlans.free.quotaBytes, locale)) : copy.ending
    case 'pastDue':
      return copy.pastDue
    case 'inactive':
      return copy.inactive
    default:
      return copy.free(formatBytes(storagePlans.free.quotaBytes, locale))
  }
}

export function includedStorageOnboardingCopy(plan: StoragePlan, t: Messages, locale: Locale): string {
  return t.settings.plan.includedStorage(plan === 'free', formatBytes(storagePlans[plan].quotaBytes, locale))
}
