import { useQuery } from '@tanstack/react-query'
import { ExternalLink } from 'lucide-react'
import { ButtonLink } from '@/components/ui/button'
import { useI18n } from '../i18n'
import { releaseUpdateQuery } from '../queries'

export function useReleaseUpdate(enabled: boolean) {
  return useQuery(releaseUpdateQuery(enabled && typeof window !== 'undefined')).data?.update
}

export function ReleaseUpdateNotice({ hosted }: { hosted: boolean }) {
  const { t } = useI18n()
  const update = useReleaseUpdate(true)
  if (!update) return null

  return (
    <aside className="mb-6 flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border border-primary/30 bg-primary/10 px-4 py-3 text-sm">
      <span className="font-medium">{t.shell.release.available(update.latestVersion)}</span>
      <ButtonLink size="sm" variant="outline" className="ml-auto" href={update.releaseUrl} target="_blank" rel="noreferrer">
        {hosted ? t.shell.release.viewWhatsNew : t.shell.release.viewRelease}
        <ExternalLink />
      </ButtonLink>
    </aside>
  )
}
