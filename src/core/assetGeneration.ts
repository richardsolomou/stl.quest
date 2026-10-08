// A stage that ran out of transient retries keeps this error prefix so storage recovery can requeue it,
// while any other failed stage stays terminal.
export const RETRIES_EXHAUSTED_PREFIX = 'Storage kept failing: '
