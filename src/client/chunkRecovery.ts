import { chunkRecoveryScript as recoveryScript } from 'ras-stack/tanstack/client'

export const chunkLoadFailureNoticeId = 'chunk-load-failure'

export const chunkRecoveryScript = recoveryScript({ storageKey: 'stlquest:chunk-reload', noticeId: chunkLoadFailureNoticeId })
