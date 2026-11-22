import { useCallback, useLayoutEffect, useRef } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useServerFn } from '@tanstack/react-start'
import { toast } from 'sonner'
import { errorMessage } from '../../../core/error'
import { statusText } from '../../../core/i18n'
import { movePlate } from '../../../server/fns'
import { useI18n } from '../../i18n'
import { invalidateQueries } from '../../queryState'
import { useWorkspaceSlug } from '../../workspace'

/** Moves a running plate's copies together, saying where they went. */
export function useMovePlate(onMoved?: (plateId: string, to: string) => void) {
  const { t } = useI18n()
  const workspaceSlug = useWorkspaceSlug()
  const queryClient = useQueryClient()
  const callMove = useServerFn(movePlate)
  const moved = useRef(onMoved)
  useLayoutEffect(() => {
    moved.current = onMoved
  })
  const mutation = useMutation({
    mutationFn: ({ plate, to }: { plate: { id: string; number: number }; to: string }) =>
      callMove({ data: { workspaceSlug, plateId: plate.id, to } }),
    onSuccess: (_result, { plate, to }) => {
      toast.success(t.plates.moved(plate.number, statusText(t, 'label', to)))
      moved.current?.(plate.id, to)
      return invalidateQueries(queryClient, 'plates', 'requests')
    },
    onError: (error) => toast.error(errorMessage(error, t.plates.moveFailed)),
  })
  const { mutate } = mutation
  return useCallback((plate: { id: string; number: number }, to: string) => mutate({ plate, to }), [mutate])
}
