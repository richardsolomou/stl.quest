export function copyRequest(request: Request, url: string, headers: Headers) {
  // The server adapter hands us a Request-shaped wrapper (srvx) that is not a genuine
  // undici Request. Passing it to `new Request(request, …)` — or calling a method that
  // dereferences the wrapper's internal `#state` — throws "Cannot read private member
  // #state from an object whose class did not declare it" on Node 24. Rebuild from the
  // public accessors only, which every Request implementation supports.
  const body = request.body
  // `duplex: 'half'` is required when constructing a request from a stream body, but is not
  // yet in the DOM `RequestInit` type.
  const init: RequestInit & { duplex?: 'half' } = { method: request.method, headers, body, signal: request.signal }
  if (body) init.duplex = 'half'
  return new Request(url, init)
}
