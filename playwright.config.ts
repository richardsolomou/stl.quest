import { defineConfig, devices } from '@playwright/test'

const port = Number(process.env.PLAYWRIGHT_PORT ?? 4173)
const coreOnly = process.env.PLAYWRIGHT_CORE_ONLY === '1'
const containerSuffix = port === 4173 ? '' : `-${port}`
const serverURL = `http://127.0.0.1:${port}`
const baseURL = serverURL
const selfHostedPort = port + 1
const selfHostedServerURL = `http://127.0.0.1:${selfHostedPort}`
const selfHostedURL = `http://stlquest.test:${selfHostedPort}`
const root = process.env.PLAYWRIGHT_DATA_ROOT ?? `/tmp/stlquest-playwright-${port}`
const selfHostedRoot = `${root}-self-hosted`
const hostedPort = port + 2
const hostedServerURL = `http://127.0.0.1:${hostedPort}`
const hostedRoot = `${root}-hosted`
const fakeS3Port = port + 3
const httpsInnerPort = port + 4
const httpsProxyPort = port + 5
const httpsProxyHealthPort = port + 7
const httpsServerURL = `https://stlquest.test:${httpsProxyPort}`
const httpsRoot = `${root}-https`
const previewPort = port + 6
const previewServerURL = `http://127.0.0.1:${previewPort}`
const previewRoot = `${root}-preview`
const trace = process.env.PLAYWRIGHT_TRACE ? 'on' : process.env.CI ? 'retain-on-failure' : 'off'

function appServer(name: string, appPort: number, dataRoot: string, environment: Record<string, string> = {}, publishedHost = '127.0.0.1') {
  if (process.env.PLAYWRIGHT_FAST_SERVER) return 'sh scripts/runFastE2eServer.sh'
  if (process.env.PLAYWRIGHT_DEV_SERVER) {
    const variables = Object.entries(environment)
      .map(([key, value]) => `${key}=${value}`)
      .join(' ')
    return `rm -rf ${dataRoot} && mkdir -p ${dataRoot}/data ${dataRoot}/prints && DATA_DIR=${dataRoot}/data PRINTS_DIR=${dataRoot}/prints PORT=${appPort} ${variables} ./node_modules/.bin/vite dev --host 127.0.0.1 --port ${appPort}`
  }
  const variables = Object.entries(environment)
    .map(([key, value]) => `-e ${key}=${value}`)
    .join(' ')
  return `docker rm -f ${name} >/dev/null 2>&1 || true; rm -rf ${dataRoot} && mkdir -p ${dataRoot}/data ${dataRoot}/prints ${dataRoot}/prints-migrated ${dataRoot}/prints-stranded && chmod 777 ${dataRoot}/data ${dataRoot}/prints ${dataRoot}/prints-migrated ${dataRoot}/prints-stranded && docker run -d --name ${name} --read-only -v ${dataRoot}:${dataRoot} --add-host host.docker.internal:host-gateway -p ${publishedHost}:${appPort}:3000 -e DATA_DIR=${dataRoot}/data -e PRINTS_DIR=${dataRoot}/prints -e STLQUEST_REALTIME_SECRET_FILE=${dataRoot}/data/realtime-secret ${variables} stlquest-e2e >/dev/null && trap 'docker rm -f ${name} >/dev/null 2>&1' EXIT INT TERM; docker logs -f ${name} & docker wait ${name}`
}

function httpsProxyServer() {
  const name = `stlquest-e2e-https-proxy${containerSuffix}`
  return `docker rm -f ${name} >/dev/null 2>&1 || true; docker run -d --name ${name} --read-only --tmpfs /tmp --add-host host.docker.internal:host-gateway -p 127.0.0.1:${httpsProxyPort}:443 -p 127.0.0.1:${httpsProxyHealthPort}:80 -e UPSTREAM=host.docker.internal:${httpsInnerPort} -e XDG_CONFIG_HOME=/tmp/caddy-config -e XDG_DATA_HOME=/tmp/caddy-data -v ${process.cwd()}/e2e/outer-proxy.Caddyfile:/etc/caddy/Caddyfile:ro caddy:2.11.4-alpine >/dev/null && trap 'docker rm -f ${name} >/dev/null 2>&1' EXIT INT TERM; docker logs -f ${name}`
}

export default defineConfig({
  testDir: './e2e',
  outputDir: 'test-results',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  // Board ordering settles through realtime invalidation, which outruns the 5s
  // default under CI load. Retries stay off, so assertions need room instead.
  expect: { timeout: 15_000 },
  reporter: process.env.CI ? 'github' : 'list',
  use: { baseURL, trace, screenshot: 'only-on-failure' },
  projects: [
    {
      name: 'chromium',
      testIgnore: [
        'auth-http.spec.ts',
        'auth-https-realtime.spec.ts',
        'preview-seed.spec.ts',
        'hosted-managed.spec.ts',
        'distributed-realtime.spec.ts',
      ],
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'hosted-managed',
      testMatch: 'hosted-managed.spec.ts',
      use: { ...devices['Desktop Chrome'], baseURL: hostedServerURL },
    },
    {
      name: 'self-hosted-http',
      testMatch: 'auth-http.spec.ts',
      use: {
        ...devices['Desktop Chrome'],
        baseURL: selfHostedURL,
        launchOptions: { args: ['--host-resolver-rules=MAP stlquest.test 127.0.0.1'] },
      },
    },
    ...(process.env.PLAYWRIGHT_DEV_SERVER || coreOnly
      ? []
      : [
          {
            name: 'self-hosted-https',
            testMatch: 'auth-https-realtime.spec.ts',
            use: {
              ...devices['Desktop Chrome'],
              baseURL: httpsServerURL,
              ignoreHTTPSErrors: true,
              launchOptions: { args: ['--host-resolver-rules=MAP stlquest.test 127.0.0.1'] },
            },
          },
          {
            name: 'preview-seed',
            testMatch: 'preview-seed.spec.ts',
            use: { ...devices['Desktop Chrome'], baseURL: previewServerURL },
          },
        ]),
  ],
  webServer: [
    {
      command: appServer(`stlquest-e2e-main${containerSuffix}`, port, root, { BETTER_AUTH_URL: baseURL }),
      url: `${serverURL}/api/health`,
      reuseExistingServer: false,
      timeout: 120_000,
    },
    ...(process.env.PLAYWRIGHT_DEV_SERVER || coreOnly
      ? []
      : [
          {
            command: appServer(
              `stlquest-e2e-https${containerSuffix}`,
              httpsInnerPort,
              httpsRoot,
              { DATABASE_URL: '', NODE_ENV: 'production' },
              '0.0.0.0',
            ),
            url: `http://127.0.0.1:${httpsInnerPort}/api/health`,
            reuseExistingServer: false,
            timeout: 120_000,
          },
          {
            command: httpsProxyServer(),
            url: `http://127.0.0.1:${httpsProxyHealthPort}/outer-health`,
            reuseExistingServer: false,
            timeout: 120_000,
          },
          {
            command: appServer(`stlquest-e2e-preview${containerSuffix}`, previewPort, previewRoot, {
              BETTER_AUTH_URL: previewServerURL,
              STLQUEST_SEED_PREVIEW: 'true',
            }),
            url: `${previewServerURL}/api/health`,
            reuseExistingServer: false,
            timeout: 120_000,
          },
        ]),
    ...(coreOnly
      ? []
      : [
          {
            command: appServer(`stlquest-e2e-self-hosted${containerSuffix}`, selfHostedPort, selfHostedRoot, {
              DATABASE_URL: '',
              NODE_ENV: 'production',
            }),
            url: `${selfHostedServerURL}/api/health`,
            reuseExistingServer: false,
            timeout: 120_000,
          },
          {
            command: `FAKE_S3_PORT=${fakeS3Port} FAKE_S3_HOST=${process.env.PLAYWRIGHT_DEV_SERVER ? '127.0.0.1' : '0.0.0.0'} ./node_modules/.bin/tsx e2e/fake-s3.ts`,
            url: `http://127.0.0.1:${fakeS3Port}`,
            reuseExistingServer: false,
            timeout: 120_000,
          },
          {
            command: appServer(`stlquest-e2e-hosted${containerSuffix}`, hostedPort, hostedRoot, {
              NODE_ENV: 'production',
              BETTER_AUTH_URL: hostedServerURL,
              STLQUEST_HOSTED: 'true',
              STLQUEST_HOSTED_STORAGE_BUCKET: 'test-bucket',
              STLQUEST_HOSTED_STORAGE_ENDPOINT: `http://host.docker.internal:${fakeS3Port}`,
              STLQUEST_HOSTED_STORAGE_REGION: 'us-east-1',
              STLQUEST_HOSTED_STORAGE_ACCESS_KEY_ID: 'test',
              STLQUEST_HOSTED_STORAGE_SECRET_ACCESS_KEY: 'test',
              STLQUEST_HOSTED_STORAGE_FORCE_PATH_STYLE: 'true',
              STRIPE_SECRET_KEY: 'sk_test_dummy',
              STRIPE_WEBHOOK_SECRET: 'whsec_dummy',
              STRIPE_SUPPORTER_PRICE_ID: 'price_supporter',
              STRIPE_PRO_PRICE_ID: 'price_pro',
            }),
            url: `${hostedServerURL}/api/health`,
            reuseExistingServer: false,
            timeout: 120_000,
          },
        ]),
  ],
})
