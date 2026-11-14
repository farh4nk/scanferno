/**
 * Walk mode: fly the camera into a room and follow where it is, so a route out can be drawn from "here".
 *
 *   await walkToRoom(showcase, overlay, fp, roomId)          // fly to the best sweep in the room, facing the way out
 *   const stop = followCamera(showcase, overlay, fp, (h) => h.mode === 'inside' && redraw(h.room, h.local))
 */
import type { Sweep } from 'mp-sdk'
import type { Overlay } from './overlay'
import { inside, roomAt } from './picking'
import { collection, type Showcase, type View } from './showcase'
import type { Floorplan, Room, XY } from './types'

export interface Here {
  mode: View | null
  /** Camera position projected onto the floor plan. */
  local: XY
  room: Room | null
  sweepId: string
}

const sweepCache = new WeakMap<Showcase, Promise<Sweep.ObservableSweepData[]>>()

function sweeps(showcase: Showcase) {
  let s = sweepCache.get(showcase)
  if (!s) {
    s = collection<Sweep.ObservableSweepData>(showcase.sdk.Sweep.data).then((all) => {
      // the first snapshot can arrive empty while the model is still loading; ask again next time
      if (!all.length) sweepCache.delete(showcase)
      return all.filter((sw) => sw.enabled && sw.alignmentType === showcase.sdk.Sweep.Alignment.ALIGNED)
    })
    sweepCache.set(showcase, s)
  }
  return s
}

/** The sweep to stand on for a room: Matterport's own room tag first, then inside the polygon, then nearest. */
export async function sweepForRoom(showcase: Showcase, overlay: Overlay, room: Room): Promise<Sweep.ObservableSweepData | null> {
  const all = await sweeps(showcase)
  if (!all.length) return null
  const local = (sw: Sweep.ObservableSweepData) => overlay.toLocal(sw.position)
  const dist = (sw: Sweep.ObservableSweepData) => Math.hypot(local(sw)[0] - room.centroid[0], local(sw)[1] - room.centroid[1])
  const nearest = (xs: Sweep.ObservableSweepData[]) => [...xs].sort((a, b) => dist(a) - dist(b))[0]
  const tagged = room.matterport_id ? all.filter((sw) => sw.roomInfo?.id === room.matterport_id) : []
  if (tagged.length) return nearest(tagged)
  const within = all.filter((sw) => inside(local(sw), room.polygon))
  return nearest(within.length ? within : all)
}

/**
 * Fly into a room in walk (inside) mode, facing `toward` (default: the room's first door on its exit route).
 * Resolves to the sweep the camera landed on, which may be just outside the room if it was never scanned
 * from inside; null if the room or a sweep could not be found.
 */
export async function walkToRoom(showcase: Showcase, overlay: Overlay, fp: Floorplan, roomId: string, toward?: XY): Promise<string | null> {
  const room = fp.rooms.find((r) => r.id === roomId)
  if (!room) return null
  const sweep = await sweepForRoom(showcase, overlay, room)
  if (!sweep) return null
  const route = fp.exit_routes?.[roomId]?.polyline
  const target = toward ?? route?.[1] ?? room.centroid
  const t = overlay.toWorld(target)
  const dx = t.x - sweep.position.x
  const dz = t.z - sweep.position.z
  const { sdk } = showcase
  await sdk.Sweep.moveTo(sweep.id, {
    rotation: Math.hypot(dx, dz) > 0.2 ? { x: -20, y: (Math.atan2(-dx, -dz) * 180) / Math.PI } : undefined,
    transition: sdk.Camera.TransitionType.FLY,
    transitionTime: 1500,
  })
  return sweep.id
}

/** Call `cb` with the way the camera faces on the floor plan (degrees counterclockwise from +x), in `stepDeg` steps. */
export function followHeading(showcase: Showcase, overlay: Overlay, cb: (deg: number) => void, stepDeg = 10): () => void {
  let last = NaN
  const sub = showcase.sdk.Camera.pose.subscribe((pose) => {
    const yaw = (pose.rotation.y * Math.PI) / 180
    const deg = (Math.atan2(Math.cos(yaw), -Math.sin(yaw)) * 180) / Math.PI - overlay.calibration.rotationDeg
    const q = Math.round(deg / stepDeg) * stepDeg
    if (q !== last) cb((last = q))
  })
  return () => sub.cancel()
}

/** Which way to turn to face `to` from `from` when facing `headingDeg`: an arrow and a word. */
export function turnHint(headingDeg: number, from: XY, to: XY): { arrow: string; text: string } {
  const bearing = (Math.atan2(to[1] - from[1], to[0] - from[0]) * 180) / Math.PI
  const rel = ((bearing - headingDeg + 540) % 360) - 180
  const hints = [['↑', 'ahead'], ['↖', 'bear left'], ['←', 'turn left'], ['↙', 'behind you, left'], ['↓', 'behind you'],
    ['↘', 'behind you, right'], ['→', 'turn right'], ['↗', 'bear right']]
  const [arrow, text] = hints[((Math.round(rel / 45) % 8) + 8) % 8]
  return { arrow, text }
}

/**
 * Call `cb` when the camera moves to a new sweep or changes mode. Returns an unsubscribe function.
 * Position and room come from the sweep itself: the pose switches to the new sweep id while the camera is
 * still flying, so its position at that moment is somewhere in between.
 */
export function followCamera(showcase: Showcase, overlay: Overlay, fp: Floorplan, cb: (h: Here) => void): () => void {
  const M = showcase.sdk.Mode.Mode
  const modes: Record<string, View> = { [M.INSIDE]: 'inside', [M.DOLLHOUSE]: 'dollhouse', [M.FLOORPLAN]: 'floorplan' }
  const byMp = new Map(fp.rooms.filter((r) => r.matterport_id).map((r) => [r.matterport_id!, r]))
  let last = ''
  let seq = 0
  const sub = showcase.sdk.Camera.pose.subscribe(async (pose) => {
    if (pose.mode === M.TRANSITIONING) return
    const mode = modes[pose.mode] ?? null
    const key = `${mode}|${mode === 'inside' ? pose.sweep : ''}`
    if (key === last) return
    last = key
    const n = ++seq
    const sweep = (await sweeps(showcase)).find((s) => s.id === pose.sweep)
    if (n !== seq) return
    const local = overlay.toLocal(sweep?.position ?? pose.position)
    const tagged = sweep?.roomInfo?.id ? byMp.get(sweep.roomInfo.id) : undefined
    cb({ mode, local, room: tagged ?? roomAt(fp, local), sweepId: pose.sweep })
  })
  return () => sub.cancel()
}
