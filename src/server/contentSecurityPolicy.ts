/**
 * The Content Security Policy's sources by directive, which `middleware.ts` turns into the header. Add the sources the
 * application's own features load from here, so recipe updates to the middleware never conflict with them.
 */
export const contentSecurityPolicy: Record<string, string[]> = {
  'default-src': ["'self'"],
  // Start streams its hydration data as inline scripts, and the root route adds chunk recovery; meshoptimizer is WebAssembly.
  'script-src': ["'self'", "'unsafe-inline'", "'wasm-unsafe-eval'"],
  'style-src': ["'self'", "'unsafe-inline'"],
  // Avatars come from Gravatar and the sign-in providers.
  'img-src': ["'self'", 'data:', 'blob:', 'https://www.gravatar.com', 'https://cdn.discordapp.com', 'https://*.googleusercontent.com'],
  'font-src': ["'self'", 'data:'],
  'connect-src': ["'self'"],
  'worker-src': ["'self'", 'blob:'],
  'object-src': ["'none'"],
  'base-uri': ["'self'"],
  'form-action': ["'self'"],
  'frame-ancestors': ["'none'"],
}
