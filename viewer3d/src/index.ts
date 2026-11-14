/**
 * Scanferno 3D: the Matterport model with our data drawn on it. Framework-free; use from any UI.
 *
 *   import { openBuilding, api, drawRooms, evacPlayer } from 'viewer3d/src'
 *   const v = await openBuilding(el, building, { sdkKey })
 *   drawRooms(v.overlay.layer('rooms'), v.floorplan, 'maze')
 *   const player = evacPlayer(v.overlay.layer('evac'), v.floorplan, await api.evac(building.id))
 *   player.play()
 *   v.onPick((p) => console.log(p.room?.label, p.local))
 *
 * Layers are named and independent; add a new feature by drawing into a new layer with the Layer
 * primitives (polygon, volume, path, marker, label, dots, tick).
 */
import { api } from './api'
import { SAVED_CALIBRATIONS } from './calibrations'
import { autoCalibrate, type CalibrationResult } from './frame'
import { Overlay } from './overlay'
import { onPick, type Pick } from './picking'
import { mountShowcase, setView, type Showcase, type View } from './showcase'
import type { Building, Floorplan } from './types'

export * from './api'
export * from './calibrations'
export * from './draw/evac'
export * from './draw/floorplan'
export * from './draw/paths'
export * from './frame'
export * from './overlay'
export * from './picking'
export * from './showcase'
export * from './types'

export interface BuildingViewer {
  building: Building
  floorplan: Floorplan
  showcase: Showcase
  overlay: Overlay
  /** How the overlay was aligned (automatic fit result, or the saved calibration). */
  alignment: CalibrationResult & { saved: boolean }
  onPick(cb: (p: Pick) => void): () => void
  setView(view: View): Promise<void>
  destroy(): void
}

export async function openBuilding(container: HTMLElement, building: Building,
  opts: { sdkKey: string; floorplan?: Floorplan; bundlePath?: string; params?: Record<string, string | number> }): Promise<BuildingViewer> {
  const [showcase, floorplan] = await Promise.all([
    mountShowcase(container, { modelId: building.matterport_model_id, sdkKey: opts.sdkKey, bundlePath: opts.bundlePath, params: opts.params }),
    opts.floorplan ? Promise.resolve(opts.floorplan) : api.floorplan(building.id),
  ])
  const fit = await autoCalibrate(showcase.sdk, floorplan)
  const saved = SAVED_CALIBRATIONS[building.id]
  const alignment = { ...fit, calibration: saved ?? fit.calibration, saved: !!saved }
  const overlay = await Overlay.create(showcase.sdk, alignment.calibration)
  const unsubs: (() => void)[] = []
  return {
    building,
    floorplan,
    showcase,
    overlay,
    alignment,
    onPick(cb) {
      const u = onPick(showcase, overlay, floorplan, cb)
      unsubs.push(u)
      return u
    },
    setView: (view) => setView(showcase.sdk, view),
    destroy() {
      unsubs.forEach((u) => u())
      overlay.dispose()
      showcase.destroy()
    },
  }
}
