import { useState, type ReactNode } from 'react'
import { Link } from '@tanstack/react-router'
import {
  Activity,
  Database,
  Info,
  KeyRound,
  Layers3,
  LayoutDashboard,
  Printer,
  RadioTower,
  SlidersHorizontal,
  UserRound,
  Users,
} from 'lucide-react'
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarRail,
  SidebarTrigger,
} from '@/components/ui/sidebar'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import type { Identity } from '../../core/types'
import type { AdminSection } from './AdminPanes'
import { Brand } from './Brand'
import type { SettingsSection } from './SettingsPanes'
import { WorkspaceSwitcher } from './WorkspaceSwitcher'

export type AppLocation = 'board' | 'planner' | `settings:${SettingsSection}` | `admin:${AdminSection}`

export function AppShell({
  active,
  identity,
  showPlanner,
  navigationEnabled = true,
  title,
  contentClassName,
  children,
}: {
  active: AppLocation
  identity: Identity
  showPlanner: boolean
  navigationEnabled?: boolean
  title: string
  contentClassName?: string
  children: ReactNode
}) {
  const [mobileOpen, setMobileOpen] = useState(false)
  return (
    <SidebarProvider>
      <AppSidebar active={active} identity={identity} showPlanner={showPlanner} navigationEnabled={navigationEnabled} />
      <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
        <SheetContent side="left" showCloseButton={false} className="w-72 gap-0 bg-sidebar p-0 text-sidebar-foreground md:hidden">
          <SheetHeader className="sr-only">
            <SheetTitle>Navigation</SheetTitle>
            <SheetDescription>PrintHub navigation</SheetDescription>
          </SheetHeader>
          <AppSidebar
            active={active}
            identity={identity}
            showPlanner={showPlanner}
            navigationEnabled={navigationEnabled}
            embedded
            onNavigate={() => setMobileOpen(false)}
          />
        </SheetContent>
      </Sheet>
      <SidebarInset className="h-svh min-w-0 overflow-hidden">
        <header className="flex h-14 shrink-0 items-center gap-3 border-b px-4">
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            className="md:hidden"
            disabled={!navigationEnabled}
            onClick={() => setMobileOpen(true)}
          >
            <LayoutDashboard className="rotate-90" />
            <span className="sr-only">Open navigation</span>
          </Button>
          <SidebarTrigger className="max-md:hidden" disabled={!navigationEnabled} />
          <div className="h-5 border-l" />
          <h1 className="truncate text-base font-semibold">{title}</h1>
        </header>
        <div className={cn('min-h-0 flex-1 overflow-auto', contentClassName)}>{children}</div>
      </SidebarInset>
    </SidebarProvider>
  )
}

function AppSidebar({
  active,
  identity,
  showPlanner,
  navigationEnabled,
  embedded = false,
  onNavigate,
}: {
  active: AppLocation
  identity: Identity
  showPlanner: boolean
  navigationEnabled: boolean
  embedded?: boolean
  onNavigate?: () => void
}) {
  const workspaceItems = [
    { section: 'account' as const, label: 'Account', icon: UserRound },
    ...(identity.role === 'admin'
      ? [
          { section: 'board' as const, label: 'Board settings', icon: SlidersHorizontal },
          { section: 'printers' as const, label: 'Printers', icon: Printer },
          { section: 'users' as const, label: 'Members', icon: Users },
          { section: 'storage' as const, label: 'Storage', icon: Database },
          { section: 'diagnostics' as const, label: 'Diagnostics', icon: Activity },
          { section: 'about' as const, label: 'About', icon: Info },
        ]
      : []),
  ]
  const adminItems = [
    { section: 'integrations' as const, label: 'Authentication & email', icon: KeyRound },
    { section: 'telemetry' as const, label: 'Telemetry', icon: RadioTower },
    { section: 'diagnostics' as const, label: 'System diagnostics', icon: Activity },
  ]

  const content = (
    <>
      <SidebarHeader className="h-14 justify-center border-b px-4">
        <Link to="/" onClick={onNavigate} className={cn('w-fit text-inherit no-underline', !navigationEnabled && 'pointer-events-none')}>
          <Brand />
        </Link>
      </SidebarHeader>
      <SidebarContent>
        <nav aria-label="Main navigation" className="flex flex-col">
          <SidebarGroup>
            <SidebarGroupLabel>Print queue</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                <NavigationItem
                  active={active === 'board'}
                  enabled={navigationEnabled}
                  to="/"
                  label="Board"
                  icon={<LayoutDashboard />}
                  onNavigate={onNavigate}
                />
                {identity.role === 'admin' && showPlanner && (
                  <NavigationItem
                    active={active === 'planner'}
                    enabled={navigationEnabled}
                    to="/planner"
                    label="Planner"
                    icon={<Layers3 />}
                    onNavigate={onNavigate}
                  />
                )}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
          <SidebarGroup>
            <SidebarGroupLabel>Workspace</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {workspaceItems.map((item) => (
                  <NavigationItem
                    key={item.section}
                    active={active === `settings:${item.section}`}
                    enabled={navigationEnabled}
                    to="/settings/$section"
                    params={{ section: item.section }}
                    label={item.label}
                    icon={<item.icon />}
                    onNavigate={onNavigate}
                  />
                ))}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
          {identity.deploymentAdmin && (
            <SidebarGroup>
              <SidebarGroupLabel>Deployment</SidebarGroupLabel>
              <SidebarGroupContent>
                <SidebarMenu>
                  {adminItems.map((item) => (
                    <NavigationItem
                      key={item.section}
                      active={active === `admin:${item.section}`}
                      enabled={navigationEnabled}
                      to="/admin/$section"
                      params={{ section: item.section }}
                      label={item.label}
                      icon={<item.icon />}
                      onNavigate={onNavigate}
                    />
                  ))}
                </SidebarMenu>
              </SidebarGroupContent>
            </SidebarGroup>
          )}
        </nav>
      </SidebarContent>
      <SidebarFooter className="border-t p-3">
        <WorkspaceSwitcher className="w-full" />
      </SidebarFooter>
    </>
  )
  if (embedded) return <div className="flex h-full min-h-0 flex-col">{content}</div>
  return (
    <Sidebar collapsible="offcanvas" data-hydrated={navigationEnabled}>
      {content}
      <SidebarRail />
    </Sidebar>
  )
}

function NavigationItem({
  active,
  enabled,
  to,
  params,
  label,
  icon,
  onNavigate,
}: {
  active: boolean
  enabled: boolean
  to: '/' | '/planner' | '/settings/$section' | '/admin/$section'
  params?: { section: SettingsSection | AdminSection }
  label: string
  icon: ReactNode
  onNavigate?: () => void
}) {
  return (
    <SidebarMenuItem>
      <SidebarMenuButton
        isActive={active}
        disabled={!enabled}
        render={<Link to={to} params={params as never} onClick={onNavigate} aria-current={active ? 'page' : undefined} />}
      >
        {icon}
        <span>{label}</span>
      </SidebarMenuButton>
    </SidebarMenuItem>
  )
}
