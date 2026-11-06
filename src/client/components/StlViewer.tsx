import { useEffect, useRef, useState } from 'react'
import { usePostHog } from '@posthog/react'
import * as THREE from 'three'
import { OrbitControls } from 'three-stdlib'
import { Button } from '@/components/ui/button'
import { stlLoadErrorReason } from '../../core/error'
import { buildScene, frameCamera, isWebGLAvailable, parseStl } from '../stl'
import { requestModelHref, type RequestAssets } from '../boardDownload'
import { useI18n } from '../i18n'

// Abort a model load that makes no progress for this long, so a stalled asset-store
// read surfaces an error instead of sitting on "loading model…" forever.
const STALL_TIMEOUT_MS = 20_000

export default function StlViewer({ request, file, hasPreview = false }: { request?: RequestAssets; file?: File; hasPreview?: boolean }) {
  const { t } = useI18n()
  const posthog = usePostHog()
  const mountRef = useRef<HTMLDivElement>(null)
  const [status, setStatus] = useState<'loading' | 'ready' | 'error' | 'invalid_mesh' | 'webgl_unavailable'>('loading')
  // A download percentage, or the phase before and after the download.
  const [loadPhase, setLoadPhase] = useState<number | 'loading' | 'preparing'>('loading')
  const [fullRequested, setFullRequested] = useState(false)
  const [attempt, setAttempt] = useState(0)

  const showingPreview = hasPreview && !fullRequested

  useEffect(() => {
    const mount = mountRef.current
    if (!mount || (!request && !file)) return

    let disposed = false
    let renderer: THREE.WebGLRenderer | undefined
    let controls: OrbitControls | undefined
    let frame = 0
    let observer: ResizeObserver | undefined

    // Watchdog: abort if the fetch or an in-progress download stalls. Re-armed on
    // every chunk, so a slow-but-moving download is left alone.
    const controller = new AbortController()
    let stallTimer: ReturnType<typeof setTimeout> | undefined
    const clearStall = () => {
      if (stallTimer) clearTimeout(stallTimer)
      stallTimer = undefined
    }
    const armStall = () => {
      clearStall()
      stallTimer = setTimeout(() => controller.abort(new DOMException('model load stalled', 'TimeoutError')), STALL_TIMEOUT_MS)
    }

    setStatus('loading')
    setLoadPhase('loading')
    void (async () => {
      try {
        // The browser can't render WebGL (blocklisted GPU, disabled, a VM). Short-circuit to a
        // distinct terminal state before spending a full download and parse on a model this
        // client can never display — and before three.js throws creating the renderer below.
        if (!isWebGLAvailable()) {
          setStatus('webgl_unavailable')
          return
        }
        let buffer: ArrayBuffer
        if (file) {
          buffer = await file.arrayBuffer()
        } else {
          armStall()
          const res = await fetch(requestModelHref(request!, showingPreview), { signal: controller.signal })
          if (!res.ok) throw new Error(`fetch failed: ${res.status}`)
          // Content-Length is the compressed size when gzipped; the real size travels separately.
          const total = Number(res.headers.get('X-File-Size') ?? res.headers.get('Content-Length')) || 0
          if (res.body && total) {
            const reader = res.body.getReader()
            const data = new Uint8Array(total)
            let received = 0
            for (;;) {
              const { done, value } = await reader.read()
              if (done) break
              armStall()
              data.set(value, received)
              received += value.length
              setLoadPhase(Math.min(100, Math.round((received / total) * 100)))
            }
            buffer = data.buffer
          } else {
            buffer = await res.arrayBuffer()
          }
          clearStall()
        }
        setLoadPhase('preparing')
        await new Promise((resolve) => setTimeout(resolve)) // Allow the status to paint before synchronous parsing.

        const geometry = await parseStl(buffer)
        if (disposed) {
          geometry.dispose()
          return
        }

        const { scene, mesh } = buildScene(geometry)
        const camera = new THREE.PerspectiveCamera(40, mount.clientWidth / mount.clientHeight)
        frameCamera(camera, mesh)

        renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true })
        renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
        renderer.setSize(mount.clientWidth, mount.clientHeight)
        mount.appendChild(renderer.domElement)

        controls = new OrbitControls(camera, renderer.domElement)
        controls.enableDamping = true
        const sphere = new THREE.Box3().setFromObject(mesh).getBoundingSphere(new THREE.Sphere())
        controls.target.copy(sphere.center)

        observer = new ResizeObserver(() => {
          if (!renderer) return
          camera.aspect = mount.clientWidth / mount.clientHeight
          camera.updateProjectionMatrix()
          renderer.setSize(mount.clientWidth, mount.clientHeight)
        })
        observer.observe(mount)

        const tick = () => {
          controls?.update()
          renderer?.render(scene, camera)
          frame = requestAnimationFrame(tick)
        }
        tick()
        setStatus('ready')
      } catch (error) {
        if (disposed) return
        // A plain AbortError is expected teardown — the viewer was disposed (modal closed /
        // retry) or the browser aborted the in-flight fetch on navigation/reload. Don't
        // surface or report it; only genuine timeouts and load failures reach error tracking.
        const reason = stlLoadErrorReason(error)
        if (!reason) return
        clearStall()
        // A lost WebGL context between the probe and renderer creation is the same permanent
        // condition — never reportable, and retrying can't fix it — so it gets the same
        // terminal state as the probe short-circuit rather than the retryable error state.
        if (reason === 'webgl_unavailable') {
          setStatus('webgl_unavailable')
          return
        }
        // Still captured, so we learn which model feature the parser rejected, but the file
        // will never parse — so it gets a terminal state without a retry, not the retryable one.
        posthog.captureException(error, { area: 'stl_viewer', showing_preview: showingPreview, reason })
        setStatus(reason === 'invalid_mesh' ? 'invalid_mesh' : 'error')
      }
    })()

    return () => {
      disposed = true
      clearStall()
      controller.abort()
      cancelAnimationFrame(frame)
      observer?.disconnect()
      controls?.dispose()
      if (renderer) {
        renderer.dispose()
        renderer.domElement.remove()
      }
    }
  }, [request, file, showingPreview, posthog, attempt])

  return (
    <div
      className="viewer relative mb-3.5 aspect-4/3 w-full overflow-hidden rounded-lg border bg-background [background-image:var(--grid)] [&_canvas]:block [&_canvas]:size-full"
      ref={mountRef}
    >
      {status === 'loading' && (
        <div className="absolute inset-0 grid place-items-center font-mono text-xs text-muted-foreground">
          {loadPhase === 'loading'
            ? t.requests.viewer.loadingModel
            : loadPhase === 'preparing'
              ? t.requests.viewer.preparing
              : t.requests.viewer.downloading(loadPhase)}
        </div>
      )}
      {status === 'error' && (
        <div className="absolute inset-0 grid place-items-center gap-2 text-center font-mono text-xs text-muted-foreground">
          <span>{t.requests.viewer.loadFailed}</span>
          <Button type="button" variant="secondary" size="xs" className="font-mono" onClick={() => setAttempt((n) => n + 1)}>
            {t.requests.viewer.retry}
          </Button>
        </div>
      )}
      {status === 'invalid_mesh' && (
        <div className="absolute inset-0 grid place-items-center gap-1 px-4 text-center font-mono text-xs text-muted-foreground">
          <span>{t.requests.viewer.invalidTitle}</span>
          <span className="opacity-70">{t.requests.viewer.invalidHint}</span>
        </div>
      )}
      {status === 'webgl_unavailable' && (
        <div className="absolute inset-0 grid place-items-center gap-1 px-4 text-center font-mono text-xs text-muted-foreground">
          <span>{t.requests.viewer.webglTitle}</span>
          <span className="opacity-70">{t.requests.viewer.webglHint}</span>
        </div>
      )}
      {status === 'ready' && showingPreview && (
        <Button
          type="button"
          variant="secondary"
          size="xs"
          className="absolute right-2 bottom-2 font-mono opacity-90"
          onClick={() => {
            posthog.capture('stl_full_detail_requested')
            setFullRequested(true)
          }}
        >
          {t.requests.viewer.loadFullDetail}
        </Button>
      )}
    </div>
  )
}
