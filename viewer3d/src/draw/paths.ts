// Routes and mayday wall-following paths, with a dot that walks the path so direction is obvious.
import type { Layer } from '../overlay'
import type { Floorplan, Mayday, Route, XY } from '../types'

export function pointAlong(points: XY[], s: number): XY {
  let left = s
  for (let i = 1; i < points.length; i++) {
    const [ax, ay] = points[i - 1]
    const [bx, by] = points[i]
    const seg = Math.hypot(bx - ax, by - ay)
    if (left <= seg && seg > 0) return [ax + ((bx - ax) * left) / seg, ay + ((by - ay) * left) / seg]
    left -= seg
  }
  return points[points.length - 1]
}

export function pathLength(points: XY[]): number {
  let L = 0
  for (let i = 1; i < points.length; i++) L += Math.hypot(points[i][0] - points[i - 1][0], points[i][1] - points[i - 1][1])
  return L
}

/** Distance along a path to the point on it closest to `p`. */
export function nearestAlong(points: XY[], p: XY): number {
  let best = Infinity
  let bestS = 0
  let s = 0
  for (let i = 1; i < points.length; i++) {
    const [ax, ay] = points[i - 1]
    const [bx, by] = points[i]
    const seg = Math.hypot(bx - ax, by - ay)
    const t = seg > 0 ? Math.max(0, Math.min(1, ((p[0] - ax) * (bx - ax) + (p[1] - ay) * (by - ay)) / (seg * seg))) : 0
    const d = Math.hypot(ax + (bx - ax) * t - p[0], ay + (by - ay) * t - p[1])
    if (d < best) {
      best = d
      bestS = s + t * seg
    }
    s += seg
  }
  return bestS
}

/** Animate `count` evenly spaced dots flowing along a path at `speed` m/s. */
export function flow(layer: Layer, points: XY[], opts: { color?: string; speed?: number; count?: number; radius?: number } = {}) {
  const L = pathLength(points)
  if (L <= 0) return
  const n = opts.count ?? Math.max(1, Math.round(L / 3))
  const dots = layer.dots(n, { color: opts.color ?? '#ffffff', radius: opts.radius ?? 0.12, height: 0.15 })
  layer.tick((_dt, t) => {
    for (let i = 0; i < n; i++) dots.set(i, pointAlong(points, ((t * (opts.speed ?? 1.4)) + (i * L) / n) % L))
    dots.commit()
  })
}

/**
 * `from` starts the route at a point inside its first room (where the camera stands) instead of the room
 * center. `xray` adds a faint copy drawn through walls plus an exit beacon, so the way out stays visible
 * from anywhere in walk mode.
 */
export function drawRoute(layer: Layer, route: Route, fp?: Floorplan, color = '#22d3ee', opts: { from?: XY; xray?: boolean; endLabel?: string } = {}) {
  const line = opts.from && route.polyline.length > 1 ? [opts.from, ...route.polyline.slice(1)] : route.polyline
  const end = line[line.length - 1]
  layer.path(line, { color, radius: 0.08, opacity: 0.95 })
  flow(layer, line, { color: '#ecfeff' })
  if (opts.xray) {
    layer.path(line, { color, radius: 0.05, opacity: 0.35, xray: true })
    layer.marker(end, { shape: 'pillar', radius: 0.25, size: 2.2, color: '#22c55e', opacity: 0.45, xray: true })
  }
  const exit = fp?.doors.find((d) => d.id === route.exit_door_id)
  const dist = opts.from ? pathLength(line) : route.distance_m
  const label = opts.endLabel ? `${dist.toFixed(0)} m · ${opts.endLabel}` : `${dist.toFixed(0)} m to exit${exit?.side ? ` ${exit.side}` : ''}`
  layer.label(end, label,
    { height: opts.xray ? 2.5 : 1.0, color, size: 0.3 })
}

export function drawMayday(layer: Layer, m: Mayday, fp?: Floorplan, color = '#f97316') {
  if (!m.wall_path.length) return
  layer.path(m.wall_path, { color, radius: 0.07, height: 0.3, opacity: 0.95 })
  flow(layer, m.wall_path, { color: '#ffedd5', speed: 0.8, count: 1, radius: 0.22 })
  const start = fp?.rooms.find((r) => r.id === m.from_room_id)
  if (start) {
    layer.marker(start.centroid, { shape: 'cone', radius: 0.3, size: 0.8, height: 1.4, color: '#ef4444', xray: true })
    layer.label(start.centroid, `MAYDAY: ${start.label}`, { height: 2.6, color: '#fecaca', size: 0.34 })
  }
  layer.label(m.wall_path[0], `${m.hand?.toUpperCase()} HAND`, { height: 0.9, color, size: 0.28 })
}
