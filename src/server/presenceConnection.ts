export function presenceConnection(release: () => void) {
  let leave = () => {}
  let heartbeat: ReturnType<typeof setInterval> | undefined
  let cleaned = false
  return {
    activate(joinedLeave: () => void, startHeartbeat: () => ReturnType<typeof setInterval>) {
      if (cleaned) {
        joinedLeave()
        return
      }
      leave = joinedLeave
      heartbeat = startHeartbeat()
    },
    cleanup() {
      if (cleaned) return
      cleaned = true
      leave()
      clearInterval(heartbeat)
      release()
    },
  }
}
