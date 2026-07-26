import { Box, CircleDot, Code2, Globe } from 'lucide-react'
import { FieldDescription } from '@/components/ui/field'
import { Item, ItemContent, ItemDescription, ItemGroup, ItemMedia, ItemTitle } from '@/components/ui/item'
import { SOURCE_CODE_URL } from '../../sourceCode'
import { Brand } from '../Brand'
import { SettingsHeader, SettingsPage, SettingsSection } from './SettingsLayout'

export function AboutPane() {
  return (
    <SettingsPage>
      <SettingsHeader title="About" description="Project information, community links, and licensing." />
      <SettingsSection>
        <Brand className="text-2xl" />
        <p className="mt-2 text-sm text-muted-foreground">Version {__APP_VERSION__}</p>
        <p className="mt-1 text-muted-foreground">A private 3D-print request and production queue for resin and filament printers.</p>
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
              <a href={SOURCE_CODE_URL} target="_blank" rel="noreferrer">
                Source code
              </a>
            }
          >
            <ItemMedia variant="icon">
              <Code2 />
            </ItemMedia>
            <ItemContent>
              <ItemTitle>Source code</ItemTitle>
              <ItemDescription>Get the corresponding source code for this version</ItemDescription>
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
        STL Quest is open source under the GNU Affero General Public License v3.0. Hosted and self-hosted users can obtain the corresponding
        source code above, and anonymous telemetry can be disabled at any time.
      </FieldDescription>
    </SettingsPage>
  )
}
