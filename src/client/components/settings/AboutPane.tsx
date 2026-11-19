import type { ReactNode } from 'react'
import { Box, CircleDot, Code2, ExternalLink, Globe } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Item, ItemActions, ItemContent, ItemDescription, ItemGroup, ItemMedia, ItemTitle } from '@/components/ui/item'
import { ISSUES_URL, RELEASES_URL, SOURCE_CODE_URL } from '../../sourceCode'
import { PageHeader, SettingsPage, SettingsSection } from './SettingsLayout'
import { useI18n } from '../../i18n'

function ProjectLink({ href, icon, title, description }: { href: string; icon: ReactNode; title: string; description: string }) {
  return (
    <Item
      variant="outline"
      render={({ children, ...props }) => (
        <a {...props} href={href} target="_blank" rel="noreferrer">
          {children}
        </a>
      )}
    >
      <ItemMedia variant="icon">{icon}</ItemMedia>
      <ItemContent>
        <ItemTitle>{title}</ItemTitle>
        <ItemDescription>{description}</ItemDescription>
      </ItemContent>
      <ItemActions>
        <ExternalLink className="size-4 text-muted-foreground" aria-hidden="true" />
      </ItemActions>
    </Item>
  )
}

export function AboutPane() {
  const { t } = useI18n()
  const copy = t.settings.about
  return (
    <SettingsPage>
      <PageHeader title={copy.title} description={copy.tagline}>
        <Badge variant="secondary" className="font-mono">
          {copy.version(__APP_VERSION__)}
        </Badge>
      </PageHeader>
      <SettingsSection title={copy.links}>
        <ItemGroup>
          <ProjectLink href="https://stl.quest" icon={<Globe />} title="stl.quest" description={copy.website.description} />
          <ProjectLink href={SOURCE_CODE_URL} icon={<Code2 />} title={copy.source.title} description={copy.source.description} />
          <ProjectLink href={ISSUES_URL} icon={<CircleDot />} title={copy.issues.title} description={copy.issues.description} />
          <ProjectLink href={RELEASES_URL} icon={<Box />} title={copy.releases.title} description={copy.releases.description} />
        </ItemGroup>
      </SettingsSection>
      <SettingsSection title={copy.licenseTitle}>
        <p className="text-sm leading-relaxed text-muted-foreground">{copy.license}</p>
      </SettingsSection>
    </SettingsPage>
  )
}
