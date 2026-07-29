const encoder = new TextEncoder()

export function serverSentEvent(event: string, data: string) {
  return encoder.encode(`event: ${event}\ndata: ${data}\n\n`)
}

export function serverSentRetry(milliseconds: number) {
  return encoder.encode(`retry: ${milliseconds}\n\n`)
}

export function serverSentComment(comment: string) {
  return encoder.encode(`: ${comment}\n\n`)
}

export function serverSentEventResponse(stream: ReadableStream) {
  return new Response(stream, {
    headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive' },
  })
}
