import { Box, CircleDot, Code2, Globe } from 'lucide-react'
import { FieldDescription } from '@/components/ui/field'
import { Item, ItemContent, ItemDescription, ItemGroup, ItemMedia, ItemTitle } from '@/components/ui/item'
import { SOURCE_CODE_URL } from '../../sourceCode'
import { Brand } from '../Brand'
import { SettingsHeader, SettingsPage, SettingsSection } from './SettingsLayout'
import { useI18n } from '../../i18n'

export function AboutPane() {
  const { t } = useI18n()
  const copy = t.settings.about
  return (
    <SettingsPage>
      <SettingsHeader title={copy.title} description={copy.description} />
      <SettingsSection>
        <Brand className="text-2xl" />
        <p className="mt-2 text-sm text-muted-foreground">{copy.version(__APP_VERSION__)}</p>
        <p className="mt-1 text-muted-foreground">{copy.tagline}</p>
      </SettingsSection>
      <SettingsSection title={copy.links}>
        <ItemGroup>
          <Item
            variant="outline"
            render={
              <a href="https://stl.quest" target="_blank" rel="noreferrer">
                {copy.website.link}
              </a>
            }
          >
            <ItemMedia variant="icon">
              <Globe />
            </ItemMedia>
            <ItemContent>
              <ItemTitle>stl.quest</ItemTitle>
              <ItemDescription>{copy.website.description}</ItemDescription>
            </ItemContent>
          </Item>
          <Item
            variant="outline"
            render={
              <a href={SOURCE_CODE_URL} target="_blank" rel="noreferrer">
                {copy.source.title}
              </a>
            }
          >
            <ItemMedia variant="icon">
              <Code2 />
            </ItemMedia>
            <ItemContent>
              <ItemTitle>{copy.source.title}</ItemTitle>
              <ItemDescription>{copy.source.description}</ItemDescription>
            </ItemContent>
          </Item>
          <Item
            variant="outline"
            render={
              <a href="https://github.com/richardsolomou/stl.quest/issues" target="_blank" rel="noreferrer">
                {copy.issues.title}
              </a>
            }
          >
            <ItemMedia variant="icon">
              <CircleDot />
            </ItemMedia>
            <ItemContent>
              <ItemTitle>{copy.issues.title}</ItemTitle>
              <ItemDescription>{copy.issues.description}</ItemDescription>
            </ItemContent>
          </Item>
          <Item
            variant="outline"
            render={
              <a href="https://github.com/richardsolomou/stl.quest/releases" target="_blank" rel="noreferrer">
                {copy.releases.title}
              </a>
            }
          >
            <ItemMedia variant="icon">
              <Box />
            </ItemMedia>
            <ItemContent>
              <ItemTitle>{copy.releases.title}</ItemTitle>
              <ItemDescription>{copy.releases.description}</ItemDescription>
            </ItemContent>
          </Item>
        </ItemGroup>
      </SettingsSection>
      <FieldDescription>{copy.license}</FieldDescription>
    </SettingsPage>
  )
}
