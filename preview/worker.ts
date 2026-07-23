import { Container, getContainer } from '@cloudflare/containers'

interface Env {
  STLQUEST: DurableObjectNamespace<STLQuestContainer>
}

export class STLQuestContainer extends Container {
  defaultPort = 3000
  sleepAfter = '30m'
  entrypoint = ['/bin/sh', '-c', 'node .output/server/seed-preview.mjs && exec node .output/server/index.mjs']
}

export default {
  fetch(request: Request, env: Env) {
    return getContainer(env.STLQUEST, 'preview').fetch(request)
  },
} satisfies ExportedHandler<Env>
