// Kept apart from the panes so route guards and navigation can name sections without bundling every pane.

export const settingsSections = [
  'board',
  'printers',
  'equipment',
  'consumables',
  'pricing',
  'users',
  'email',
  'storage',
  'spoolman',
  'bambuddy',
] as const
export type SettingsSection = (typeof settingsSections)[number]

/** Workspace settings by the job they serve: who uses the workspace, what it prints with, and what it connects to. */
export const settingsSectionGroups = [
  { id: 'workspace', sections: ['board', 'users'] },
  { id: 'production', sections: ['printers', 'equipment', 'consumables', 'pricing'] },
  { id: 'connections', sections: ['email', 'storage', 'spoolman', 'bambuddy'] },
] as const satisfies { id: string; sections: SettingsSection[] }[]

export function isSettingsSection(value: string): value is SettingsSection {
  return settingsSections.includes(value as SettingsSection)
}

export const superAdminSections = ['overview', 'users', 'workspaces', 'integrations', 'telemetry', 'diagnostics'] as const
export type SuperAdminSection = (typeof superAdminSections)[number]

export function isSuperAdminSection(value: string): value is SuperAdminSection {
  return superAdminSections.includes(value as SuperAdminSection)
}
