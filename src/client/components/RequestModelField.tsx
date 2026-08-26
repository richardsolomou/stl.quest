import { useRef } from 'react'
import { Link2, Trash2, Upload } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { LazyStlViewer } from './LazyStlViewer'
import { SourcePreviewImage } from './SourcePreviewImage'
import type { ModelAttachment } from '../modelAttachment'
import type { PublicPrintRequest } from '../../core/types'

/** The model area of the print dialog: the viewer or cover when reading, and the model picker when editing. */
export function RequestModelField({
  request,
  editing,
  attachment,
}: {
  request: PublicPrintRequest
  editing: boolean
  attachment: ModelAttachment
}) {
  const input = useRef<HTMLInputElement>(null)
  const staged = attachment.staged.file

  const cover = (
    <SourcePreviewImage
      key={request.id}
      request={request}
      className="mb-3 h-40 w-full rounded-lg border border-ticket-foreground/15 bg-background object-contain [background-image:var(--grid)] sm:h-48"
      fallback={
        <div className="mb-3 grid h-40 place-items-center rounded-lg border-2 border-dashed border-primary/25 bg-primary/5">
          <Link2 className="size-10 text-primary" />
        </div>
      }
    />
  )

  if (!editing) return request.hasFile ? <LazyStlViewer request={request} hasPreview={request.hasPreview} /> : cover

  return (
    <div className="mb-3">
      <input
        ref={input}
        type="file"
        accept=".stl,.3mf"
        className="sr-only"
        onChange={(event) => {
          const file = event.target.files?.[0]
          event.target.value = ''
          if (file) attachment.choose(file)
        }}
      />
      {attachment.state === 'empty' ? (
        <button
          type="button"
          className="grid h-40 w-full place-items-center gap-1 rounded-lg border-2 border-dashed border-primary/40 bg-primary/5 text-sm text-primary hover:bg-primary/10 sm:h-48"
          onClick={() => input.current?.click()}
        >
          <Upload className="size-8" />
          {request.hasFile ? 'Choose the model that replaces it' : 'Choose a model'}
          <span className="text-xs text-muted-foreground">.stl or .3mf, or drop one on this dialog</span>
        </button>
      ) : (
        <div className="relative [&>*]:mb-0">
          {staged ? <LazyStlViewer file={staged} /> : <LazyStlViewer request={request} hasPreview={request.hasPreview} />}
          <Button
            type="button"
            variant="secondary"
            size="icon"
            aria-label={staged ? 'Remove the chosen model' : 'Remove the current model'}
            className="absolute top-2 right-2"
            onClick={() => attachment.clear()}
          >
            <Trash2 />
          </Button>
        </div>
      )}
      <p className="mt-1.5 text-xs text-muted-foreground">
        {staged ? (
          <>
            <span className="font-medium text-foreground">{staged.name}</span> is uploaded when you save.
          </>
        ) : attachment.state === 'empty' ? (
          request.hasFile ? (
            <>
              Pick the file that takes its place before saving.{' '}
              <button type="button" className="underline underline-offset-4" onClick={() => attachment.reset()}>
                Keep the current model
              </button>
            </>
          ) : (
            'This print is saved from a link. Choose a model to make it printable.'
          )
        ) : (
          'Delete this model to put a different one in its place.'
        )}
      </p>
    </div>
  )
}
