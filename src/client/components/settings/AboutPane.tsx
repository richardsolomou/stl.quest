import { Box, CircleDot, Code2 } from 'lucide-react'
import { FieldDescription } from '@/components/ui/field'
import { Item, ItemContent, ItemDescription, ItemGroup, ItemMedia, ItemTitle } from '@/components/ui/item'
import { SettingsHeader, SettingsPage, SettingsSection } from './SettingsLayout'

export function AboutPane() {
  return (
    <SettingsPage>
      <SettingsHeader title="About" description="Project information, community links, and licensing." />
      <SettingsSection>
        <div className="flex items-center gap-3.5">
          <img className="size-13 shrink-0 rounded-xl" src="/favicon.svg" alt="" aria-hidden="true" />
          <div>
            <strong>PrintHub v{__APP_VERSION__}</strong>
            <p className="mt-1 text-muted-foreground">
              A private resin and filament production queue that keeps models, planning, and production history on storage you control.
            </p>
          </div>
        </div>
      </SettingsSection>
      <SettingsSection title="Project links">
        <ItemGroup>
          <Item
            variant="outline"
            render={
              <a href="https://github.com/richardsolomou/printhub" target="_blank" rel="noreferrer">
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
              <a href="https://github.com/richardsolomou/printhub/issues" target="_blank" rel="noreferrer">
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
              <a href="https://github.com/richardsolomou/printhub/releases" target="_blank" rel="noreferrer">
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
        PrintHub is open source under the MIT License. It has no hosted service or mandatory cloud account, and anonymous telemetry can be
        disabled at any time.
      </FieldDescription>
    </SettingsPage>
  )
}
