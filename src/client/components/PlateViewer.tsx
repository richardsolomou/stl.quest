import { useEffect, useRef } from 'react'
import * as THREE from 'three'
import { OrbitControls } from 'three-stdlib'
import { planningMarginMm, type PlatePlacement, type PrinterProfile } from '../../core/platePlanner'

type Props = {
  printer: PrinterProfile
  placements: PlatePlacement[]
  geometries: Map<string, THREE.BufferGeometry>
  invalidCopyIds: Set<string>
  geometryRevision?: number
}

export function PlateViewer({ printer, placements, geometries, invalidCopyIds, geometryRevision = 0 }: Props) {
  const hostRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const host = hostRef.current
    if (!host) return

    const scene = new THREE.Scene()
    scene.background = new THREE.Color(0x17181c)
    const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 5000)
    const plateSize = Math.max(printer.widthMm, printer.depthMm)
    const plateCenter = new THREE.Vector3(printer.widthMm / 2, printer.depthMm / 2, 0)
    const viewDirection = new THREE.Vector3(0, -1, 0.58).normalize()
    const contentHeight = Math.max(1, ...placements.map((placement) => placement.estimatedSupportedHeightMm))
    const orbitTarget = plateCenter.clone().setZ(Math.min(contentHeight * 0.35, printer.heightMm * 0.4))
    camera.up.set(0, 0, 1)

    const renderer = new THREE.WebGLRenderer({ antialias: true })
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    renderer.outputColorSpace = THREE.SRGBColorSpace
    renderer.domElement.style.display = 'block'
    renderer.domElement.style.width = '100%'
    renderer.domElement.style.height = '100%'
    host.appendChild(renderer.domElement)

    const controls = new OrbitControls(camera, renderer.domElement)
    controls.target.copy(orbitTarget)
    controls.enablePan = false
    controls.enableDamping = true
    controls.dampingFactor = 0.08
    controls.rotateSpeed = 0.85
    controls.zoomSpeed = 0.9
    controls.zoomToCursor = false
    controls.minDistance = plateSize * 0.25
    controls.maxDistance = Math.hypot(printer.widthMm, printer.depthMm, printer.heightMm) * 3
    controls.minPolarAngle = 0.01
    controls.maxPolarAngle = Math.PI - 0.01
    controls.update()

    const plateGeometry = new THREE.BoxGeometry(printer.widthMm, printer.depthMm, 1.2)
    const plateMaterial = new THREE.MeshStandardMaterial({
      color: 0x2b2e38,
      roughness: 0.72,
      metalness: 0.18,
      transparent: true,
      opacity: 0.42,
      depthWrite: false,
      side: THREE.DoubleSide,
    })
    const plate = new THREE.Mesh(plateGeometry, plateMaterial)
    plate.position.set(plateCenter.x, plateCenter.y, -0.6)
    scene.add(plate)

    const plateEdgesGeometry = new THREE.EdgesGeometry(plateGeometry)
    const plateEdgesMaterial = new THREE.LineBasicMaterial({ color: 0xf2a33c })
    const plateEdges = new THREE.LineSegments(plateEdgesGeometry, plateEdgesMaterial)
    plateEdges.position.copy(plate.position)
    scene.add(plateEdges)

    const gridGeometry = rectangularGrid(printer.widthMm, printer.depthMm, 10)
    const gridMaterial = new THREE.LineBasicMaterial({ color: 0x454a55, transparent: true, opacity: 0.8 })
    const grid = new THREE.LineSegments(gridGeometry, gridMaterial)
    grid.position.set(plateCenter.x, plateCenter.y, 0.04)
    scene.add(grid)

    const volumeBoxGeometry = new THREE.BoxGeometry(printer.widthMm, printer.depthMm, printer.heightMm)
    const volumeGeometry = new THREE.EdgesGeometry(volumeBoxGeometry)
    volumeBoxGeometry.dispose()
    const volumeMaterial = new THREE.LineBasicMaterial({ color: 0x737986, transparent: true, opacity: 0.28 })
    const volume = new THREE.LineSegments(volumeGeometry, volumeMaterial)
    volume.position.set(plateCenter.x, plateCenter.y, printer.heightMm / 2)
    scene.add(volume)

    scene.add(new THREE.HemisphereLight(0xffffff, 0x20232b, 1.75))
    const keyLight = new THREE.DirectionalLight(0xffffff, 2.4)
    keyLight.position.set(plateSize, -plateSize, printer.heightMm * 1.8)
    scene.add(keyLight)
    const fillLight = new THREE.DirectionalLight(0xf2a33c, 0.75)
    fillLight.position.set(-plateSize, plateSize, printer.heightMm)
    scene.add(fillLight)

    const modelMaterials: THREE.Material[] = []
    const padGeometry = new THREE.BoxGeometry(1, 1, 0.3)
    const padMaterials: THREE.Material[] = []
    const hulls = new Map<string, Point[]>()
    const pads: { x: number; y: number; size: number; invalid: boolean }[] = []
    for (const placement of placements) {
      const geometry = geometries.get(placement.requestId)
      if (!geometry) continue
      let hull = hulls.get(placement.requestId)
      if (!hull) {
        hull = projectedHull(geometry, placement.orientationQuaternion)
        hulls.set(placement.requestId, hull)
      }
      pads.push(...allowancePads(hull, placement, printer, invalidCopyIds.has(placement.copyId)))
    }
    for (const invalid of [false, true]) {
      const group = pads.filter((pad) => pad.invalid === invalid)
      if (!group.length) continue
      const material = new THREE.MeshBasicMaterial({
        color: invalid ? 0xe0604f : 0xf2a33c,
        transparent: true,
        opacity: 0.38,
        depthWrite: false,
      })
      padMaterials.push(material)
      const mesh = new THREE.InstancedMesh(padGeometry, material, group.length)
      const matrix = new THREE.Matrix4()
      const position = new THREE.Vector3()
      const rotation = new THREE.Quaternion()
      const scale = new THREE.Vector3()
      for (const [index, pad] of group.entries()) {
        position.set(pad.x, pad.y, 0.2)
        scale.set(pad.size, pad.size, 1)
        mesh.setMatrixAt(index, matrix.compose(position, rotation, scale))
      }
      mesh.instanceMatrix.needsUpdate = true
      scene.add(mesh)
    }
    const groups = new Map<string, PlatePlacement[]>()
    for (const placement of placements) {
      const key = `${placement.requestId}:${invalidCopyIds.has(placement.copyId) ? 'invalid' : 'valid'}`
      const group = groups.get(key) ?? []
      group.push(placement)
      groups.set(key, group)
    }
    for (const group of groups.values()) {
      const first = group[0]
      if (!first) continue
      const geometry = geometries.get(first.requestId)
      if (!geometry) continue
      const material = new THREE.MeshStandardMaterial({
        color: invalidCopyIds.has(first.copyId) ? 0xe0604f : 0x79c97c,
        roughness: 0.48,
        metalness: 0.04,
        side: THREE.DoubleSide,
      })
      modelMaterials.push(material)
      const orientation = new THREE.Quaternion(...(first.orientationQuaternion ?? [0, 0, 0, 1]))
      const orientedGeometry = geometry.clone().applyQuaternion(orientation)
      const geometryBounds = new THREE.Box3().setFromBufferAttribute(orientedGeometry.getAttribute('position') as THREE.BufferAttribute)
      const geometryCenter = geometryBounds.getCenter(new THREE.Vector3())
      orientedGeometry.dispose()
      const mesh = new THREE.InstancedMesh(geometry, material, group.length)
      const matrix = new THREE.Matrix4()
      const position = new THREE.Vector3()
      const rotation = new THREE.Quaternion()
      const scale = new THREE.Vector3(1, 1, 1)
      const axis = new THREE.Vector3(0, 0, 1)
      const plateRotation = new THREE.Quaternion()
      const rotatedCenter = new THREE.Vector3()
      for (const [index, placement] of group.entries()) {
        plateRotation.setFromAxisAngle(axis, (placement.rotationZDegrees * Math.PI) / 180)
        rotatedCenter.copy(geometryCenter).applyQuaternion(plateRotation)
        position.set(placement.xMm - rotatedCenter.x, placement.yMm - rotatedCenter.y, -geometryBounds.min.z)
        rotation.copy(plateRotation).multiply(new THREE.Quaternion(...(placement.orientationQuaternion ?? [0, 0, 0, 1])))
        mesh.setMatrixAt(index, matrix.compose(position, rotation, scale))
      }
      mesh.instanceMatrix.needsUpdate = true
      scene.add(mesh)
    }

    const resize = () => {
      const width = Math.max(1, host.clientWidth)
      const height = Math.max(1, host.clientHeight)
      renderer.setSize(width, height)
      camera.aspect = width / height
      const verticalFov = THREE.MathUtils.degToRad(camera.fov)
      const horizontalFov = 2 * Math.atan(Math.tan(verticalFov / 2) * camera.aspect)
      const fitWidth = printer.widthMm / (2 * Math.tan(horizontalFov / 2))
      const fitDepth = printer.depthMm / (2 * Math.tan(verticalFov / 2))
      const distance = Math.max(fitWidth, fitDepth) * 1.28
      camera.position.copy(orbitTarget).addScaledVector(viewDirection, distance)
      camera.lookAt(orbitTarget)
      camera.updateProjectionMatrix()
      controls.target.copy(orbitTarget)
      controls.update()
    }
    const observer = new ResizeObserver(resize)
    observer.observe(host)
    resize()
    renderer.setAnimationLoop(() => {
      controls.update()
      renderer.render(scene, camera)
    })

    return () => {
      observer.disconnect()
      renderer.setAnimationLoop(null)
      controls.dispose()
      plateGeometry.dispose()
      plateMaterial.dispose()
      plateEdgesGeometry.dispose()
      plateEdgesMaterial.dispose()
      gridGeometry.dispose()
      gridMaterial.dispose()
      volumeGeometry.dispose()
      volumeMaterial.dispose()
      padGeometry.dispose()
      for (const material of padMaterials) material.dispose()
      for (const material of modelMaterials) material.dispose()
      renderer.dispose()
      renderer.domElement.remove()
    }
  }, [geometries, geometryRevision, invalidCopyIds, placements, printer])

  return (
    <div
      ref={hostRef}
      className="h-[min(62dvh,820px)] min-h-72 w-full max-w-full min-w-0 overflow-hidden rounded-xl border bg-[#17181c] sm:h-[min(70dvh,820px)] sm:min-h-90"
    />
  )
}

type Point = { x: number; y: number }

function projectedHull(geometry: THREE.BufferGeometry, orientationTuple?: [number, number, number, number]): Point[] {
  const positions = geometry.getAttribute('position') as THREE.BufferAttribute
  const stride = Math.max(1, Math.floor(positions.count / 2_000))
  const points: Point[] = []
  const orientation = new THREE.Quaternion(...(orientationTuple ?? [0, 0, 0, 1]))
  const transformedVertex = new THREE.Vector3()
  const transformedBounds = new THREE.Box3()
  for (let index = 0; index < positions.count; index++) {
    transformedVertex.fromBufferAttribute(positions, index).applyQuaternion(orientation)
    transformedBounds.expandByPoint(transformedVertex)
  }
  const center = transformedBounds.getCenter(new THREE.Vector3())
  for (let index = 0; index < positions.count; index += stride) {
    transformedVertex.fromBufferAttribute(positions, index).applyQuaternion(orientation)
    points.push({ x: transformedVertex.x - center.x, y: transformedVertex.y - center.y })
  }
  points.sort((first, second) => first.x - second.x || first.y - second.y)
  if (points.length <= 2) return points
  const lower: Point[] = []
  for (const point of points) {
    while (lower.length >= 2 && cross(lower.at(-2)!, lower.at(-1)!, point) <= 0) lower.pop()
    lower.push(point)
  }
  const upper: Point[] = []
  for (let index = points.length - 1; index >= 0; index--) {
    const point = points[index]
    while (upper.length >= 2 && cross(upper.at(-2)!, upper.at(-1)!, point) <= 0) upper.pop()
    upper.push(point)
  }
  lower.pop()
  upper.pop()
  return [...lower, ...upper]
}

function allowancePads(hull: Point[], placement: PlatePlacement, printer: PrinterProfile, invalid: boolean) {
  if (hull.length < 2) return []
  const allowance = planningMarginMm(printer)
  if (allowance <= 0) return []
  const padSize = Math.max(2, Math.min(7, allowance * 0.8))
  const interval = Math.max(padSize * 1.65, 5)
  const center = hull.reduce((total, point) => ({ x: total.x + point.x / hull.length, y: total.y + point.y / hull.length }), {
    x: 0,
    y: 0,
  })
  const rotation = (placement.rotationZDegrees * Math.PI) / 180
  const cosine = Math.cos(rotation)
  const sine = Math.sin(rotation)
  const pads: { x: number; y: number; size: number; invalid: boolean }[] = []
  for (let index = 0; index < hull.length; index++) {
    const start = hull[index]
    const end = hull[(index + 1) % hull.length]
    const length = Math.hypot(end.x - start.x, end.y - start.y)
    const count = Math.max(1, Math.ceil(length / interval))
    for (let step = 0; step < count; step++) {
      const ratio = (step + 0.5) / count
      const localX = start.x + (end.x - start.x) * ratio
      const localY = start.y + (end.y - start.y) * ratio
      const directionX = localX - center.x
      const directionY = localY - center.y
      const directionLength = Math.hypot(directionX, directionY) || 1
      const expandedX = localX + (directionX / directionLength) * allowance * 0.55
      const expandedY = localY + (directionY / directionLength) * allowance * 0.55
      pads.push({
        x: placement.xMm + expandedX * cosine - expandedY * sine,
        y: placement.yMm + expandedX * sine + expandedY * cosine,
        size: padSize,
        invalid,
      })
    }
  }
  return pads
}

function cross(origin: Point, first: Point, second: Point) {
  return (first.x - origin.x) * (second.y - origin.y) - (first.y - origin.y) * (second.x - origin.x)
}

function rectangularGrid(widthMm: number, depthMm: number, stepMm: number) {
  const vertices: number[] = []
  const left = -widthMm / 2
  const right = widthMm / 2
  const top = -depthMm / 2
  const bottom = depthMm / 2
  for (let x = Math.ceil(left / stepMm) * stepMm; x <= right; x += stepMm) vertices.push(x, top, 0, x, bottom, 0)
  for (let y = Math.ceil(top / stepMm) * stepMm; y <= bottom; y += stepMm) vertices.push(left, y, 0, right, y, 0)
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3))
  return geometry
}
