import type { RealtimePolicy } from './realtime'

// Keep `centrifugo.json`'s namespaces in step with these channels.
export const channelPolicy: RealtimePolicy = {
  /** The workspace channel is a server-side subscription, so the browser can neither leave nor forge it. */
  serverChannels: (viewer) => (viewer.workspace ? [`workspace:${viewer.workspace.id}`] : []),
  /** Board presence exposes who else is on the board, so a member who only sees their own requests stays off the channel. */
  canSubscribe: (viewer, channel) => Boolean(viewer.workspace?.boardPresence) && channel === `board:${viewer.workspace?.slug}`,
}
