import { useRef } from 'react'
import { FileUp, Paperclip } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/ui/spinner'
import type { ModelAttachment } from '../modelAttachment'

/** Picks the model file to put on a request; the dialogs the attachment needs are rendered by the caller. */
export function AttachModelButton({ attachment }: { attachment: ModelAttachment }) {
  const input = useRef<HTMLInputElement>(null)
  const { busy, progress, replacing } = attachment

  return (
    <>
      <input
        ref={input}
        type="file"
        accept=".stl,.3mf"
        className="sr-only"
        onChange={(event) => {
          const file = event.target.files?.[0]
          event.target.value = ''
          if (file) attachment.start(file)
        }}
      />
      <Button type="button" variant="outline" disabled={busy} onClick={() => input.current?.click()}>
        {busy ? <Spinner /> : replacing ? <FileUp /> : <Paperclip />}
        {busy ? `Uploading… ${progress}%` : replacing ? 'Replace model' : 'Attach model'}
      </Button>
    </>
  )
}
