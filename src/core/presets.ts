/** The catalogue entry with this ID, once the catalogue has loaded and when it has one. */
export function findPreset<Preset extends { id: string }>(presets: readonly Preset[] | undefined, id?: string) {
  return id ? presets?.find((preset) => preset.id === id) : undefined
}
