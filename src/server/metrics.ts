import { Counter, Gauge, Histogram, Registry, collectDefaultMetrics } from 'prom-client'

export const metrics = new Registry()

collectDefaultMetrics({ register: metrics, prefix: 'printhub_' })

export const apiRequests = new Counter({
  name: 'printhub_api_requests_total',
  help: 'API requests by route, method, and status.',
  labelNames: ['route', 'method', 'status'] as const,
  registers: [metrics],
})

export const apiDuration = new Histogram({
  name: 'printhub_api_request_duration_seconds',
  help: 'API request duration by route and method.',
  labelNames: ['route', 'method'] as const,
  buckets: [0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10, 30],
  registers: [metrics],
})

export const uploadsCompleted = new Counter({
  name: 'printhub_uploads_completed_total',
  help: 'Completed uploads.',
  registers: [metrics],
})

export const uploadBytes = new Counter({
  name: 'printhub_upload_bytes_total',
  help: 'Bytes accepted by completed uploads.',
  registers: [metrics],
})

export const assetJobs = new Counter({
  name: 'printhub_asset_jobs_total',
  help: 'Asset jobs by outcome.',
  labelNames: ['outcome'] as const,
  registers: [metrics],
})

export const assetJobDuration = new Histogram({
  name: 'printhub_asset_job_duration_seconds',
  help: 'Asset generation duration by outcome.',
  labelNames: ['outcome'] as const,
  buckets: [0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10, 30, 60],
  registers: [metrics],
})

export const assetQueueDepth = new Gauge({
  name: 'printhub_asset_queue_depth',
  help: 'Queued and running asset jobs.',
  labelNames: ['state'] as const,
  registers: [metrics],
})

export const activeSseConnections = new Gauge({
  name: 'printhub_sse_connections',
  help: 'Active server-sent event connections.',
  registers: [metrics],
})

export const incompleteUploads = new Gauge({
  name: 'printhub_incomplete_uploads',
  help: 'Incomplete upload sessions and reserved bytes.',
  labelNames: ['measure'] as const,
  registers: [metrics],
})

export const databaseMetrics = new Gauge({
  name: 'printhub_database',
  help: 'Database size and last successful integrity check timestamp.',
  labelNames: ['measure'] as const,
  registers: [metrics],
})

export const diskFreeBytes = new Gauge({
  name: 'printhub_disk_free_bytes',
  help: 'Available bytes on managed filesystems.',
  labelNames: ['mount'] as const,
  registers: [metrics],
})

export const storageFailures = new Counter({
  name: 'printhub_storage_failures_total',
  help: 'Storage readiness failures.',
  registers: [metrics],
})
