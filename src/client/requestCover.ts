import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useServerFn } from '@tanstack/react-start'
import { usePostHog } from '@posthog/react'
import { errorMessage, isReportableMutationError } from '../core/error'
import type { Messages } from '../core/i18n'
import type { PublicPrintRequest } from '../core/types'
import { setRequestCover } from '../server/fns'
import { encodeCover, UnreadableCover } from './coverImage'
import { useWorkspaceSlug } from './workspace'
import { useI18n } from './i18n'

export type RequestCover = ReturnType<typeof useRequestCover>

/** Stores a picture someone pastes, drops, or picks as a linked print's cover, as soon as they give it. */
export function useRequestCover(request: PublicPrintRequest) {
  const { t } = useI18n()
  const workspaceSlug = useWorkspaceSlug()
  const queryClient = useQueryClient()
  const posthog = usePostHog()
  const callSetCover = useServerFn(setRequestCover)
  const mutation = useMutation({
    mutationFn: async (file: File) => {
      await callSetCover({ data: { workspaceSlug, id: request.id, image: await encodeCover(file) } })
      // Waits for the new cover, so the slot does not flash the old one between saving and the realtime refresh.
      await queryClient.invalidateQueries({ queryKey: ['requests', workspaceSlug] })
    },
    onError: (failure) => {
      if (!(failure instanceof UnreadableCover) && isReportableMutationError(failure)) {
        posthog.captureException(failure, { action: 'set_request_cover' })
      }
    },
  })

  return {
    choose: (file: File) => mutation.mutate(file),
    pending: mutation.isPending,
    error: mutation.error ? coverErrorMessage(mutation.error, t.requests) : undefined,
  }
}

export function coverErrorMessage(error: unknown, t: Messages['requests']) {
  return error instanceof UnreadableCover ? t.cover.unreadable : errorMessage(error, t.cover.rejected)
}
