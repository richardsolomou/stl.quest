export function needsStorageOnboarding(storageConfigured: boolean) {
  return !storageConfigured
}

export function storageSetupState(storageConfigured: boolean, storageReady: boolean) {
  return !storageConfigured ? 'unconfigured' : storageReady ? 'ready' : 'unavailable'
}
