import { createServerEntry, createStartHandler, defaultStreamHandler } from '@tanstack/react-start/server'
import { basePath } from './basePath'
import { withPathname } from './server/basePath'

const prefix = basePath()
// The build's script and stylesheet links are root-relative, so a base path set at runtime is prefixed onto them here.
const entry = createServerEntry({ fetch: createStartHandler({ handler: defaultStreamHandler, transformAssets: prefix || undefined }) })

// Requests arrive without the base path (see `server/basePath.ts`). Server functions are matched that way, but the router
// redirects any URL that differs from the public one it links to, so it gets the base path back. Start reads the URL as
// soon as its entry is called, so this happens outside it.
export default {
  fetch: (request: Request, options?: Parameters<typeof entry.fetch>[1]) => {
    const { pathname } = new URL(request.url)
    const routed = prefix && !pathname.startsWith(process.env.TSS_SERVER_FN_BASE!) ? withPathname(request, `${prefix}${pathname}`) : request
    return entry.fetch(routed, options)
  },
}
