import type { RealtimeViewer } from './realtime'

// Application policy: keep `centrifugo.json`'s namespaces in step with these channels.

/** Channels the connection token subscribes the viewer to on the server, so the browser can neither leave nor forge them. */
export function serverChannels(viewer: RealtimeViewer) {
  return viewer.workspace ? [`workspace:${viewer.workspace.id}`] : []
}

/** Board presence exposes who else is on the board, so a member who only sees their own requests stays off the channel. */
export function canSubscribe(viewer: RealtimeViewer, channel: string) {
  return Boolean(viewer.workspace?.boardPresence) && channel === `board:${viewer.workspace?.slug}`
}
