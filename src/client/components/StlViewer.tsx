import { useEffect, useRef, useState } from 'react'
import { usePostHog } from '@posthog/react'
import * as THREE from 'three'
import { OrbitControls } from 'three-stdlib'
import { Button } from '@/components/ui/button'
import { stlLoadErrorReason } from '../../core/error'
import { buildScene, frameCamera, isWebGLAvailable, parseStl } from '../stl'
import { requestModelHref, type RequestAssets } from '../boardDownload'

// Abort a model load that makes no progress for this long, so a stalled asset-store
// read surfaces an error instead of sitting on "loading model…" forever.
const STALL_TIMEOUT_MS = 20_000

export default function StlViewer({ request, file, hasPreview = false }: { request?: RequestAssets; file?: File; hasPreview?: boolean }) {
  const posthog = usePostHog()
  const mountRef = useRef<HTMLDivElement>(null)
  const [status, setStatus] = useState<'loading' | 'ready' | 'error' | 'invalid_mesh' | 'webgl_unavailable'>('loading')
  const [statusText, setStatusText] = useState('loading model…')
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
    setStatusText('loading model…')
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
              setStatusText(`downloading… ${Math.min(100, Math.round((received / total) * 100))}%`)
            }
            buffer = data.buffer
          } else {
            buffer = await res.arrayBuffer()
          }
          clearStall()
        }
        setStatusText('preparing model…')
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
        // Still captured, so we learn which STL/3MF feature the parser rejected, but the file
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
        <div className="absolute inset-0 grid place-items-center font-mono text-xs text-muted-foreground">{statusText}</div>
      )}
      {status === 'error' && (
        <div className="absolute inset-0 grid place-items-center gap-2 text-center font-mono text-xs text-muted-foreground">
          <span>couldn't load this model</span>
          <Button type="button" variant="secondary" size="xs" className="font-mono" onClick={() => setAttempt((n) => n + 1)}>
            retry
          </Button>
        </div>
      )}
      {status === 'invalid_mesh' && (
        <div className="absolute inset-0 grid place-items-center gap-1 px-4 text-center font-mono text-xs text-muted-foreground">
          <span>we can't display this model</span>
          <span className="opacity-70">this file couldn't be read as a 3D model, so it can't be shown here.</span>
        </div>
      )}
      {status === 'webgl_unavailable' && (
        <div className="absolute inset-0 grid place-items-center gap-1 px-4 text-center font-mono text-xs text-muted-foreground">
          <span>3D preview needs WebGL</span>
          <span className="opacity-70">your browser can't display WebGL, so this model can't be rendered here.</span>
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
          preview · load full detail
        </Button>
      )}
    </div>
  )
}
