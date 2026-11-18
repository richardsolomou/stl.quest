export function storageSetupState(storageConfigured: boolean, storageReady: boolean) {
  return !storageConfigured ? 'unconfigured' : storageReady ? 'ready' : 'unavailable'
}
