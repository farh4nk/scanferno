/**
 * Floor plan meters <-> Showcase world coordinates.
 *
 * Showcase is y-up. For every hero scan the floor plan (x, y) lands at world (x, floor, -y), because
 * floorplan.json comes from the same Matterport model's vector data. `Calibration` keeps a small
 * correction on top of that (offset + rotation in the floor plane, floor height), fitted automatically
 * by matching Showcase rooms to floorplan rooms by Matterport room id, and editable by hand.
 */
import type { Room, Sweep } from 'mp-sdk'
import { collection, type MpSdk } from './showcase'
import type { Floorplan, XY } from './types'

export interface Calibration {
  /** Offset in floor plan meters, applied after rotation. */
  dx: number
  dy: number
  /** Rotation of the floor plan about the vertical axis, counterclockwise seen from above. */
  rotationDeg: number
  /** World height (y) of the scanned floor. */
  floorHeight: number
}

export interface WorldPoint {
  x: number
  y: number
  z: number
}

export const IDENTITY: Calibration = { dx: 0, dy: 0, rotationDeg: 0, floorHeight: 0 }

export function toWorld(c: Calibration, p: XY, height = 0): WorldPoint {
  const a = (c.rotationDeg * Math.PI) / 180
  const x = p[0] * Math.cos(a) - p[1] * Math.sin(a) + c.dx
  const y = p[0] * Math.sin(a) + p[1] * Math.cos(a) + c.dy
  return { x, y: c.floorHeight + height, z: -y }
}

export function toLocal(c: Calibration, w: WorldPoint): XY {
  const a = (-c.rotationDeg * Math.PI) / 180
  const x = w.x - c.dx
  const y = -w.z - c.dy
  return [x * Math.cos(a) - y * Math.sin(a), x * Math.sin(a) + y * Math.cos(a)]
}

export interface CalibrationResult {
  calibration: Calibration
  /** Rooms matched between Showcase and floorplan.json. */
  matched: number
  /** RMS distance between matched room centers after the fit, meters. */
  rmsM: number | null
  source: 'rooms' | 'sweeps' | 'default'
}

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b)
  return s.length ? s[Math.floor(s.length / 2)] : 0
}

function bboxSize(pts: XY[]): XY {
  const xs = pts.map((p) => p[0])
  const ys = pts.map((p) => p[1])
  return [Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)]
}

function bboxCenter(pts: XY[]): XY {
  const xs = pts.map((p) => p[0])
  const ys = pts.map((p) => p[1])
  return [(Math.min(...xs) + Math.max(...xs)) / 2, (Math.min(...ys) + Math.max(...ys)) / 2]
}

/** Fit floor height and plane offset from Showcase room bounds (rotation assumed 0; see header). */
export async function autoCalibrate(sdk: MpSdk, fp: Floorplan): Promise<CalibrationResult> {
  const rooms = await collection<Room.RoomData>(sdk.Room.data)
  const byMp = new Map(fp.rooms.filter((r) => r.matterport_id).map((r) => [r.matterport_id!, r]))
  const pairs = rooms.flatMap((sr) => {
    const r = byMp.get(sr.id)
    return r ? [{ sr, r }] : []
  })

  // floorplan.py keeps only the largest piece of a multi-part room, so some Showcase bounds are much
  // bigger than our polygon; their centers disagree and would skew the fit.
  const sameSize = pairs.filter(({ sr, r }) => {
    const [w, h] = bboxSize(r.polygon)
    const close = (a: number, b: number) => Math.abs(a - b) < 0.5 + 0.15 * Math.max(a, b)
    return close(w, sr.size.x) && close(h, sr.size.z)
  })
  const fitPairs = sameSize.length ? sameSize : pairs

  if (fitPairs.length) {
    const diffs = fitPairs.map(({ sr, r }) => {
      const ours = bboxCenter(r.polygon)
      const theirs: XY = [(sr.bounds.min.x + sr.bounds.max.x) / 2, -(sr.bounds.min.z + sr.bounds.max.z) / 2]
      return [theirs[0] - ours[0], theirs[1] - ours[1]] as XY
    })
    const dx = median(diffs.map((d) => d[0]))
    const dy = median(diffs.map((d) => d[1]))
    const rms = Math.sqrt(diffs.reduce((s, d) => s + (d[0] - dx) ** 2 + (d[1] - dy) ** 2, 0) / diffs.length)
    const floorHeight = median(fitPairs.map(({ sr }) => sr.bounds.min.y))
    return { calibration: { dx: round(dx), dy: round(dy), rotationDeg: 0, floorHeight: round(floorHeight) }, matched: fitPairs.length, rmsM: round(rms), source: 'rooms' }
  }

  const sweeps = await collection<Sweep.ObservableSweepData>(sdk.Sweep.data)
  if (sweeps.length) {
    // Sweep positions are the camera, about 1.55 m above the floor.
    const floorHeight = median(sweeps.map((s) => s.position.y)) - 1.55
    return { calibration: { ...IDENTITY, floorHeight: round(floorHeight) }, matched: 0, rmsM: null, source: 'sweeps' }
  }
  return { calibration: { ...IDENTITY }, matched: 0, rmsM: null, source: 'default' }
}

const round = (v: number) => Math.round(v * 1000) / 1000
