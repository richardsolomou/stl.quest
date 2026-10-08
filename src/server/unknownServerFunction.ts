export const staleClientMessage = 'STL Quest has been updated. Refresh the page to continue.'

/**
 * A tab opened before a release can still call a server function that release removed. The framework answers with a
 * JSON 500 that its client returns as a successful result, so this plain-text error replaces it; every client version
 * shows a failed mutation's message.
 */
export function unknownServerFunctionResponse(error: unknown) {
  if (!(error instanceof Error) || !error.message.startsWith('Server function info not found for ')) return undefined
  return new Response(staleClientMessage, { status: 404, headers: { 'Content-Type': 'text/plain; charset=utf-8' } })
}
