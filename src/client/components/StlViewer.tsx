import { useEffect, useRef, useState } from 'react'
import { usePostHog } from '@posthog/react'
import * as THREE from 'three'
import { OrbitControls } from 'three-stdlib'
import { Button } from '@/components/ui/button'
import { buildScene, frameCamera, parseStl } from '../stl'

// Abort a model load that makes no progress for this long, so a stalled asset-store
// read surfaces an error instead of sitting on "loading model…" forever.
const STALL_TIMEOUT_MS = 20_000

export default function StlViewer({ requestId, file, hasPreview = false }: { requestId?: string; file?: File; hasPreview?: boolean }) {
  const posthog = usePostHog()
  const mountRef = useRef<HTMLDivElement>(null)
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [statusText, setStatusText] = useState('loading model…')
  const [fullRequested, setFullRequested] = useState(false)
  const [attempt, setAttempt] = useState(0)

  const showingPreview = hasPreview && !fullRequested

  useEffect(() => {
    const mount = mountRef.current
    if (!mount || (!requestId && !file)) return

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
        let buffer: ArrayBuffer
        if (file) {
          buffer = await file.arrayBuffer()
        } else {
          armStall()
          const res = await fetch(`/api/files/${requestId}?inline=1${showingPreview ? '&preview=1' : ''}`, { signal: controller.signal })
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
        // A disposal abort (modal closed / retry) is expected — don't surface or report it.
        if (!disposed) {
          clearStall()
          posthog.captureException(error, {
            area: 'stl_viewer',
            showing_preview: showingPreview,
            reason: controller.signal.aborted ? 'timeout' : 'load_failed',
          })
          setStatus('error')
        }
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
  }, [requestId, file, showingPreview, posthog, attempt])

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
