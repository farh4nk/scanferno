/**
 * Click on the model -> floor plan point (and room). The bundle is served from our own origin, so we can
 * listen to pointer events inside the Showcase iframe directly, then ray-cast the click with
 * Renderer.getWorldPositionData: once against the floor plane (the floor plan point under the cursor, even
 * over a wall top) and once against the scan mesh (what was actually hit, in 3D).
 */
import type { WorldPoint } from './frame'
import type { Overlay } from './overlay'
import type { Showcase } from './showcase'
import type { Floorplan, Room, XY } from './types'

export interface Pick {
  /** Floor plan point under the cursor (ray hit on the floor plane). */
  local: XY
  /** Where the ray hits the scan mesh, if it does. */
  world: WorldPoint | null
  /** Height of the mesh hit above the scanned floor. */
  height: number | null
  room: Room | null
  screen: { x: number; y: number }
}

const CLICK_SLOP_PX = 5

/** Call `onPick` for clicks (not drags) on the model. Returns an unsubscribe function. */
export function onPick(showcase: Showcase, overlay: Overlay, fp: Floorplan | null, onPick: (p: Pick) => void): () => void {
  const win = showcase.iframe.contentWindow!
  let down: { x: number; y: number } | null = null
  const onDown = (e: PointerEvent) => {
    down = { x: e.clientX, y: e.clientY }
  }
  const onUp = async (e: PointerEvent) => {
    if (!down || Math.hypot(e.clientX - down.x, e.clientY - down.y) > CLICK_SLOP_PX) return
    const p = await pickAt(showcase, overlay, fp, { x: e.clientX, y: e.clientY })
    if (p) onPick(p)
  }
  win.addEventListener('pointerdown', onDown, true)
  win.addEventListener('pointerup', onUp, true)
  return () => {
    win.removeEventListener('pointerdown', onDown, true)
    win.removeEventListener('pointerup', onUp, true)
  }
}

/** Ray-cast a screen point (pixels from the Showcase iframe's top-left). Null if it misses the floor. */
export async function pickAt(showcase: Showcase, overlay: Overlay, fp: Floorplan | null, screen: { x: number; y: number }): Promise<Pick | null> {
  const r = showcase.sdk.Renderer
  const floorY = overlay.calibration.floorHeight
  const [floor, mesh] = await Promise.all([r.getWorldPositionData(screen, floorY), r.getWorldPositionData(screen)])
  if (!floor.position) return null
  const local = overlay.toLocal(floor.position)
  return {
    local,
    world: mesh.position ?? null,
    height: mesh.position ? mesh.position.y - floorY : null,
    room: fp ? roomAt(fp, local) : null,
    screen,
  }
}

/** Smallest room whose polygon contains the point. */
export function roomAt(fp: Floorplan, p: XY): Room | null {
  const hits = fp.rooms.filter((r) => inside(p, r.polygon) && !(r.holes ?? []).some((h) => inside(p, h)))
  hits.sort((a, b) => (a.area_m2 ?? 0) - (b.area_m2 ?? 0))
  return hits[0] ?? null
}

export function inside([x, y]: XY, poly: XY[]): boolean {
  let hit = false
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i]
    const [xj, yj] = poly[j]
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) hit = !hit
  }
  return hit
}
