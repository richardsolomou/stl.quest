import { useRef } from 'react'
import { ImageUp, Link2, Trash2, Upload } from 'lucide-react'
import { Button, buttonVariants } from '@/components/ui/button'
import { Spinner } from '@/components/ui/spinner'
import { cn } from '@/lib/utils'
import { LazyStlViewer } from './LazyStlViewer'
import { SourcePreviewImage } from './SourcePreviewImage'
import { CoverDrop, CoverPrompt } from './CoverDrop'
import { DialogProblem } from './DialogProblem'
import type { ModelAttachment } from '../modelAttachment'
import type { RequestCover } from '../requestCover'
import type { PublicPrintRequest } from '../../core/types'
import { useI18n } from '../i18n'

/**
 * The model area of the print dialog: the viewer or cover when reading, and the model picker when editing. A linked
 * print's cover takes a pasted, dropped, or picked picture whenever `cover` is given.
 */
export function RequestModelField({
  request,
  editing,
  attachment,
  cover,
}: {
  request: PublicPrintRequest
  editing: boolean
  attachment: ModelAttachment
  cover?: RequestCover
}) {
  const { t } = useI18n()
  const input = useRef<HTMLInputElement>(null)
  const staged = attachment.staged.file

  const coverImage = (
    <SourcePreviewImage
      request={request}
      className="mb-3 h-40 w-full rounded-lg border border-ticket-foreground/15 bg-thumb object-contain sm:h-48"
      fallback={
        <div className="mb-3 grid h-40 place-items-center rounded-lg border-2 border-dashed border-foreground/20 bg-thumb">
          <Link2 className="size-10 text-muted-foreground" />
        </div>
      }
    />
  )

  if (!editing && request.hasFile) return <LazyStlViewer request={request} hasPreview={request.hasPreview} />
  if (!editing && !cover) return coverImage
  if (!editing && cover) {
    const prompt = <CoverPrompt prompt={t.requests.cover.prompt} hint={t.requests.cover.hint} />
    return (
      <div className="mb-3">
        <CoverDrop
          noDrag
          label={request.hasSourceImage ? t.requests.cover.replace : t.requests.cover.choose}
          disabled={cover.pending}
          className="block h-40 w-full sm:h-48"
          onImage={cover.choose}
        >
          {request.hasSourceImage ? (
            <SourcePreviewImage
              request={request}
              className="size-full rounded-lg border border-ticket-foreground/15 bg-thumb object-contain"
              fallback={prompt}
              overlay={
                <span aria-hidden className={cn(buttonVariants({ variant: 'outline', size: 'sm' }), 'absolute right-2 bottom-2')}>
                  <ImageUp /> {t.requests.cover.replace}
                </span>
              }
            />
          ) : (
            prompt
          )}
          {cover.pending && (
            <output className="absolute inset-0 grid place-items-center rounded-lg bg-thumb/85 text-sm font-semibold">
              <span className="inline-flex items-center gap-2">
                <Spinner /> {t.requests.cover.saving}
              </span>
            </output>
          )}
        </CoverDrop>
        <DialogProblem title={t.requests.cover.failedTitle} hint={t.requests.cover.failedHint} error={cover.error} />
      </div>
    )
  }

  return (
    <div className="mb-3">
      <input
        ref={input}
        type="file"
        accept=".stl,.3mf,.obj"
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
          className="grid h-40 w-full place-items-center gap-1 rounded-lg border-2 border-dashed border-foreground/25 bg-thumb text-sm font-semibold text-foreground transition-colors hover:border-primary sm:h-48"
          onClick={() => input.current?.click()}
        >
          <Upload className="size-8" />
          {request.hasFile ? t.requests.modelField.chooseReplacement : t.requests.modelField.chooseModel}
          <span className="text-xs text-muted-foreground">{t.requests.modelField.formats}</span>
        </button>
      ) : (
        <div className="relative [&>*]:mb-0">
          {staged ? <LazyStlViewer file={staged} /> : <LazyStlViewer request={request} hasPreview={request.hasPreview} />}
          <Button
            type="button"
            variant="secondary"
            size="icon"
            aria-label={staged ? t.requests.modelField.removeChosen : t.requests.modelField.removeCurrent}
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
            <span className="font-medium text-foreground">{staged.name}</span>
            {t.requests.modelField.uploadedOnSave}
          </>
        ) : attachment.state === 'empty' ? (
          request.hasFile ? (
            <>
              {t.requests.modelField.pickReplacement}{' '}
              <button type="button" className="underline underline-offset-4" onClick={() => attachment.reset()}>
                {t.requests.modelField.keepCurrent}
              </button>
            </>
          ) : (
            t.requests.modelField.linkOnlyHint
          )
        ) : (
          t.requests.modelField.deleteToReplace
        )}
      </p>
    </div>
  )
}
