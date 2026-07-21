import { Box, CircleDot, Code2, Globe } from 'lucide-react'
import { FieldDescription } from '@/components/ui/field'
import { Item, ItemContent, ItemDescription, ItemGroup, ItemMedia, ItemTitle } from '@/components/ui/item'
import { Brand } from '../Brand'
import { SettingsHeader, SettingsPage, SettingsSection } from './SettingsLayout'

export function AboutPane() {
  return (
    <SettingsPage>
      <SettingsHeader title="About" description="Project information, community links, and licensing." />
      <SettingsSection>
        <Brand className="text-2xl" />
        <p className="mt-2 text-sm text-muted-foreground">Version {__APP_VERSION__}</p>
        <p className="mt-1 text-muted-foreground">
          A private resin and filament production queue that keeps models, planning, and production history on storage you control.
        </p>
      </SettingsSection>
      <SettingsSection title="Project links">
        <ItemGroup>
          <Item
            variant="outline"
            render={
              <a href="https://stl.quest" target="_blank" rel="noreferrer">
                Website
              </a>
            }
          >
            <ItemMedia variant="icon">
              <Globe />
            </ItemMedia>
            <ItemContent>
              <ItemTitle>stl.quest</ItemTitle>
              <ItemDescription>Visit the official STL Quest website</ItemDescription>
            </ItemContent>
          </Item>
          <Item
            variant="outline"
            render={
              <a href="https://github.com/richardsolomou/stl.quest" target="_blank" rel="noreferrer">
                Source code
              </a>
            }
          >
            <ItemMedia variant="icon">
              <Code2 />
            </ItemMedia>
            <ItemContent>
              <ItemTitle>Source code</ItemTitle>
              <ItemDescription>Explore the project, star it, or contribute</ItemDescription>
            </ItemContent>
          </Item>
          <Item
            variant="outline"
            render={
              <a href="https://github.com/richardsolomou/stl.quest/issues" target="_blank" rel="noreferrer">
                Issues and ideas
              </a>
            }
          >
            <ItemMedia variant="icon">
              <CircleDot />
            </ItemMedia>
            <ItemContent>
              <ItemTitle>Issues and ideas</ItemTitle>
              <ItemDescription>Report a bug or suggest an improvement</ItemDescription>
            </ItemContent>
          </Item>
          <Item
            variant="outline"
            render={
              <a href="https://github.com/richardsolomou/stl.quest/releases" target="_blank" rel="noreferrer">
                Release notes
              </a>
            }
          >
            <ItemMedia variant="icon">
              <Box />
            </ItemMedia>
            <ItemContent>
              <ItemTitle>Release notes</ItemTitle>
              <ItemDescription>See what changed between versions</ItemDescription>
            </ItemContent>
          </Item>
        </ItemGroup>
      </SettingsSection>
      <FieldDescription>
        STL Quest is open source under the MIT License. It has no hosted service or mandatory cloud account, and anonymous telemetry can be
        disabled at any time.
      </FieldDescription>
    </SettingsPage>
  )
}
