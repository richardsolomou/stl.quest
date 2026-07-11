import { useEffect, useRef, useState } from 'react'
import { usePostHog } from '@posthog/react'
import * as THREE from 'three'
import { OrbitControls } from 'three-stdlib'
import { buildScene, frameCamera, parseStl } from '../lib/stl'

export default function StlViewer({
  jobId,
  file,
  hasPreview = false,
}: {
  jobId?: string
  file?: File
  hasPreview?: boolean
}) {
  const posthog = usePostHog()
  const mountRef = useRef<HTMLDivElement>(null)
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [statusText, setStatusText] = useState('loading model…')
  const [fullRequested, setFullRequested] = useState(false)

  const showingPreview = hasPreview && !fullRequested

  useEffect(() => {
    const mount = mountRef.current
    if (!mount || (!jobId && !file)) return

    let disposed = false
    let renderer: THREE.WebGLRenderer | undefined
    let controls: OrbitControls | undefined
    let frame = 0
    let observer: ResizeObserver | undefined

    setStatus('loading')
    setStatusText('loading model…')
    ;(async () => {
      try {
        let buffer: ArrayBuffer
        if (file) {
          buffer = await file.arrayBuffer()
        } else {
          const res = await fetch(`/api/files/${jobId}?inline=1${showingPreview ? '&preview=1' : ''}`)
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
              data.set(value, received)
              received += value.length
              setStatusText(`downloading… ${Math.min(100, Math.round((received / total) * 100))}%`)
            }
            buffer = data.buffer
          } else {
            buffer = await res.arrayBuffer()
          }
        }
        setStatusText('preparing model…')
        await new Promise((r) => setTimeout(r)) // let the status paint before the parse blocks

        const geometry = parseStl(buffer)
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
        if (!disposed) {
          posthog.captureException(error, {
            area: 'stl_viewer',
            job_id: jobId,
            showing_preview: showingPreview,
          })
          setStatus('error')
        }
      }
    })()

    return () => {
      disposed = true
      cancelAnimationFrame(frame)
      observer?.disconnect()
      controls?.dispose()
      if (renderer) {
        renderer.dispose()
        renderer.domElement.remove()
      }
    }
  }, [jobId, file, showingPreview, posthog])

  return (
    <div className="viewer" ref={mountRef}>
      {status === 'loading' && <div className="viewer-status">{statusText}</div>}
      {status === 'error' && <div className="viewer-status">couldn't load this model</div>}
      {status === 'ready' && showingPreview && (
        <button
          type="button"
          className="load-full"
          onClick={() => {
            posthog.capture('stl_full_detail_requested', { job_id: jobId })
            setFullRequested(true)
          }}
        >
          preview · load full detail
        </button>
      )}
    </div>
  )
}
