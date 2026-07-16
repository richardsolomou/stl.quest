import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useServerFn } from '@tanstack/react-start'
import { toast } from 'sonner'
import { Field, FieldDescription, FieldError, FieldLabel } from '@/components/ui/field'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { updateBoardSettings } from '../../../server/fns'
import { boardQuery } from '../../queries'
import { useWorkspaceSlug } from '../../workspace'
import { SettingsHeader, SettingsPage, SettingsSection } from './SettingsLayout'

const VISIBILITY_OPTIONS = [
  { value: 'shared', label: 'Shared — everyone sees every request' },
  { value: 'private', label: 'Private — requesters see only their own' },
] as const

export function BoardPane() {
  const workspaceSlug = useWorkspaceSlug()
  const { data: current } = useQuery(boardQuery(workspaceSlug))
  const callUpdate = useServerFn(updateBoardSettings)
  const queryClient = useQueryClient()
  const mutation = useMutation({
    mutationFn: callUpdate,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['board-settings'] })
      toast.success('Board settings saved.')
    },
  })
  if (!current) return <SettingsHeader title="Board" description="Loading board settings…" />

  return (
    <SettingsPage>
      <SettingsHeader title="Board" description="Control how requests are shared between admins and requesters." />
      <SettingsSection>
        <Field>
          <FieldLabel htmlFor="board-visibility">Request visibility</FieldLabel>
          <Select
            items={VISIBILITY_OPTIONS}
            value={current.privateRequests ? 'private' : 'shared'}
            disabled={mutation.isPending}
            onValueChange={(value) => mutation.mutate({ data: { workspaceSlug, privateRequests: value === 'private' } })}
          >
            <SelectTrigger className="w-full" id="board-visibility">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {VISIBILITY_OPTIONS.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <FieldDescription>
            Private suits print farms and paid work: requesters see, reorder, and withdraw only their own requests. Admins always see
            everything.
          </FieldDescription>
        </Field>
        <FieldError>{mutation.error?.message || (mutation.error ? 'Could not save board settings.' : '')}</FieldError>
      </SettingsSection>
    </SettingsPage>
  )
}
