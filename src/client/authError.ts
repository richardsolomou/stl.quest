export function authErrorMessage(error: unknown, fallback: string) {
  if (!error || typeof error !== 'object') return fallback
  const { message } = error as { message?: unknown }
  return typeof message === 'string' && message.trim() ? message : fallback
}
