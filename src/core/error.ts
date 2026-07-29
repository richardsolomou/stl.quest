export function errorMessage<Fallback extends string | undefined>(error: unknown, fallback: Fallback): string | Fallback {
  if (!error || typeof error !== 'object') return fallback
  const { message } = error as { message?: unknown }
  return typeof message === 'string' && message.trim() ? message : fallback
}
