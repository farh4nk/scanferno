// Static floor plan layers: room fills, labels, doors, exits, windows, outline.
import type { Layer } from '../overlay'
import type { Door, Floorplan, Room } from '../types'

export const TYPE_COLORS: Record<string, string> = {
  office: '#60a5fa',
  hallway: '#a3a3a3',
  kitchen: '#f59e0b',
  restroom: '#2dd4bf',
  storage: '#a78bfa',
  lobby: '#34d399',
  stairwell: '#f472b6',
  open_area: '#38bdf8',
  other: '#94a3b8',
}

/** 0 (easy way out) green -> 1 (maze) red. */
export function mazeColor(score: number): string {
  const s = Math.max(0, Math.min(1, score))
  return `hsl(${Math.round((1 - s) * 120)}, 85%, 50%)`
}

export type RoomColoring = 'type' | 'maze' | ((room: Room) => string | null)

export function drawRooms(layer: Layer, fp: Floorplan, coloring: RoomColoring = 'type', opacity = 0.35) {
  for (const r of fp.rooms) {
    const color = typeof coloring === 'function' ? coloring(r)
      : coloring === 'maze' ? mazeColor(fp.maze_score?.[r.id] ?? 0)
      : TYPE_COLORS[r.type] ?? TYPE_COLORS.other
    if (color) layer.polygon(r.polygon, { color, opacity, holes: r.holes })
  }
}

export function drawLabels(layer: Layer, fp: Floorplan, text: (room: Room) => string = (r) => r.label) {
  for (const r of fp.rooms) layer.label(r.centroid, text(r), { size: 0.45, height: 1.4 })
}

export function drawOutline(layer: Layer, fp: Floorplan, color = '#e5e7eb') {
  layer.path(fp.outline, { color, radius: 0.04, height: 0.05, closed: true, opacity: 0.8 })
}

export function drawDoors(layer: Layer, fp: Floorplan) {
  for (const d of fp.doors.filter((d) => !d.is_exit)) {
    layer.marker(d.position, { shape: 'disc', radius: Math.max(0.2, d.width_m / 2), color: d.inferred ? '#fbbf24' : '#e5e7eb', opacity: 0.7 })
  }
}

export function exitLabel(d: Door): string {
  return `EXIT${d.side ? ` ${d.side}` : ''}${d.inferred ? ' (inferred)' : ''}`
}

export function drawExits(layer: Layer, fp: Floorplan) {
  for (const d of fp.doors.filter((d) => d.is_exit)) {
    const color = d.inferred ? '#a3e635' : '#22c55e'
    layer.marker(d.position, { shape: 'pillar', radius: 0.12, size: 2.2, color, xray: true })
    layer.marker(d.position, { shape: 'ring', radius: Math.max(0.35, d.width_m / 2 + 0.1), color })
    layer.label(d.position, exitLabel(d), { size: 0.32, height: 2.5, color: '#bbf7d0' })
  }
}

export function drawWindows(layer: Layer, fp: Floorplan) {
  for (const w of fp.windows.filter((w) => w.exterior)) {
    layer.marker(w.position, { shape: 'sphere', radius: 0.12, height: Math.max(0.3, w.sill_m + 0.4), color: '#7dd3fc' })
  }
}

/** Translucent column over a set of rooms: search plan, trapped-victim candidates, fire area. */
export function highlightRooms(layer: Layer, fp: Floorplan, roomIds: string[], color: string, opts: { pulse?: boolean; label?: string } = {}) {
  const rooms = fp.rooms.filter((r) => roomIds.includes(r.id))
  const meshes = rooms.map((r) => layer.volume(r.polygon, { color, opacity: 0.22 }))
  if (opts.label) for (const r of rooms) layer.label(r.centroid, opts.label, { height: 2.1, color })
  if (opts.pulse) {
    layer.tick((_dt, t) => {
      const o = 0.12 + 0.12 * (1 + Math.sin(t * 4)) / 2
      for (const m of meshes) (m.material as { opacity: number }).opacity = o
    })
  }
}
