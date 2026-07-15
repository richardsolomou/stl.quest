type Point = [number, number, number]

export function boxStl(name: string, width: number, depth: number, height: number) {
  const points: Point[] = [
    [0, 0, 0],
    [width, 0, 0],
    [width, depth, 0],
    [0, depth, 0],
    [0, 0, height],
    [width, 0, height],
    [width, depth, height],
    [0, depth, height],
  ]
  const faces = [
    [0, 2, 1],
    [0, 3, 2],
    [4, 5, 6],
    [4, 6, 7],
    [0, 1, 5],
    [0, 5, 4],
    [1, 2, 6],
    [1, 6, 5],
    [2, 3, 7],
    [2, 7, 6],
    [3, 0, 4],
    [3, 4, 7],
  ]
  const facets = faces
    .map(([a, b, c]) => {
      const normal = faceNormal(points[a], points[b], points[c])
      return `  facet normal ${normal.join(' ')}
    outer loop
      vertex ${points[a].join(' ')}
      vertex ${points[b].join(' ')}
      vertex ${points[c].join(' ')}
    endloop
  endfacet`
    })
    .join('\n')
  return Buffer.from(`solid ${name}\n${facets}\nendsolid ${name}\n`)
}

function faceNormal(a: Point, b: Point, c: Point): Point {
  const ab = [b[0] - a[0], b[1] - a[1], b[2] - a[2]] as Point
  const ac = [c[0] - a[0], c[1] - a[1], c[2] - a[2]] as Point
  const normal: Point = [ab[1] * ac[2] - ab[2] * ac[1], ab[2] * ac[0] - ab[0] * ac[2], ab[0] * ac[1] - ab[1] * ac[0]]
  const length = Math.hypot(...normal)
  return [normal[0] / length, normal[1] / length, normal[2] / length]
}
