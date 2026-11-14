/**
 * Draw on top of the Matterport model in floor plan meters.
 *
 *   const overlay = await Overlay.create(showcase.sdk, calibration)
 *   const layer = overlay.layer('evac')
 *   layer.polygon(room.polygon, { color: '#f43', opacity: 0.3 })
 *   const dots = layer.dots(40, { color: '#fff' }); dots.set(0, [1.2, 3.4]); dots.commit()
 *   layer.tick((dt) => ...)   // runs inside Showcase's render loop
 *   layer.clear()
 *
 * Inside a layer, (x, y) are floor plan meters and `height` is meters above the scanned floor. One scene
 * object holds a root group whose transform is the calibration, so re-calibrating moves every layer.
 * Every three.js object must be built with Showcase's own three (`sdk.Scene.THREE`), never an imported
 * copy, or the renderer rejects it.
 */
import type * as THREENS from 'three'
import type { Calibration } from './frame'
import { toLocal, toWorld, type WorldPoint } from './frame'
import type { MpSdk } from './showcase'
import type { XY } from './types'

type THREE = typeof THREENS
type Ticker = (dtSeconds: number, elapsedSeconds: number) => void

export interface FillStyle {
  color?: string
  opacity?: number
  /** Height above the floor; keep fills a few cm up so they don't z-fight with the scan mesh. */
  height?: number
  /** Draw through walls (ignores depth). Good for markers and labels in dollhouse view. */
  xray?: boolean
}

export interface PathStyle extends FillStyle {
  radius?: number
  closed?: boolean
}

export interface MarkerStyle extends FillStyle {
  shape?: 'pillar' | 'disc' | 'ring' | 'sphere' | 'cone'
  radius?: number
  /** Pillar/cone height, meters. */
  size?: number
}

export interface LabelStyle {
  color?: string
  background?: string
  /** Text height in meters. */
  size?: number
  height?: number
  xray?: boolean
}

let registered = 0

export class Overlay {
  readonly THREE: THREE
  private readonly root: THREENS.Group
  private readonly frame: THREENS.Group
  private readonly layers = new Map<string, Layer>()
  private readonly tickers = new Set<Ticker>()
  private elapsed = 0
  private constructor(readonly sdk: MpSdk, private cal: Calibration, private readonly stopObject: () => void) {
    this.THREE = sdk.Scene.THREE as unknown as THREE
    this.root = new this.THREE.Group()
    this.root.rotation.x = -Math.PI / 2
    this.frame = new this.THREE.Group()
    this.root.add(this.frame)
    this.applyCalibration()
  }

  static async create(sdk: MpSdk, calibration: Calibration): Promise<Overlay> {
    const name = `scanferno.overlay.${++registered}`
    let overlay!: Overlay
    await sdk.Scene.registerComponents([{
      name,
      factory: () => ({
        onInit(this: { outputs: { objectRoot: unknown } }) {
          this.outputs.objectRoot = overlay.root
        },
        onTick(dtMs: number) {
          overlay.tick(dtMs / 1000)
        },
      }) as never,
    }])
    const [object] = await sdk.Scene.createObjects(1)
    overlay = new Overlay(sdk, calibration, () => object.stop())
    object.addNode().addComponent(name, {})
    object.start()
    return overlay
  }

  get calibration(): Calibration {
    return { ...this.cal }
  }

  setCalibration(c: Calibration) {
    this.cal = { ...c }
    this.applyCalibration()
  }

  toWorld(p: XY, height = 0): WorldPoint {
    return toWorld(this.cal, p, height)
  }

  toLocal(w: WorldPoint): XY {
    return toLocal(this.cal, w)
  }

  /** Get or create a named layer. Layers are independent: clear/hide one without touching the others. */
  layer(name: string): Layer {
    let l = this.layers.get(name)
    if (!l) {
      l = new Layer(name, this.THREE, (t) => {
        this.tickers.add(t)
        return () => this.tickers.delete(t)
      })
      this.frame.add(l.group)
      this.layers.set(name, l)
    }
    return l
  }

  layerNames(): string[] {
    return [...this.layers.keys()]
  }

  dispose() {
    for (const l of this.layers.values()) l.clear()
    this.layers.clear()
    this.tickers.clear()
    this.stopObject()
  }

  private applyCalibration() {
    this.root.position.set(0, this.cal.floorHeight, 0)
    this.frame.position.set(this.cal.dx, this.cal.dy, 0)
    this.frame.rotation.z = (this.cal.rotationDeg * Math.PI) / 180
  }

  private tick(dt: number) {
    this.elapsed += dt
    for (const t of this.tickers) t(dt, this.elapsed)
  }
}

export class Layer {
  readonly group: THREENS.Group
  private untick: (() => void)[] = []

  constructor(readonly name: string, private readonly THREE: THREE, private readonly addTicker: (t: Ticker) => () => void) {
    this.group = new THREE.Group()
    this.group.name = name
  }

  get visible() {
    return this.group.visible
  }

  set visible(v: boolean) {
    this.group.visible = v
  }

  /** Remove and dispose everything in this layer, including its tick callbacks. */
  clear() {
    this.untick.forEach((u) => u())
    this.untick = []
    for (const child of [...this.group.children]) {
      this.group.remove(child)
      disposeTree(child)
    }
  }

  /** Run every frame until the layer is cleared. Returns a function that stops it early. */
  tick(fn: Ticker): () => void {
    const stop = this.addTicker(fn)
    this.untick.push(stop)
    return stop
  }

  add<T extends THREENS.Object3D>(obj: T): T {
    this.group.add(obj)
    return obj
  }

  material(s: FillStyle, fallback = '#ffffff'): THREENS.MeshBasicMaterial {
    return new this.THREE.MeshBasicMaterial({
      color: new this.THREE.Color(s.color ?? fallback),
      transparent: true,
      opacity: s.opacity ?? 1,
      side: this.THREE.DoubleSide,
      depthWrite: false,
      depthTest: !s.xray,
    })
  }

  /** Flat filled polygon on the floor (rooms, zones, hazard areas). */
  polygon(points: XY[], s: FillStyle & { holes?: XY[][] } = {}): THREENS.Mesh {
    const T = this.THREE
    const shape = new T.Shape(points.map(([x, y]) => new T.Vector2(x, y)))
    for (const h of s.holes ?? []) shape.holes.push(new T.Path(h.map(([x, y]) => new T.Vector2(x, y))))
    const mesh = new T.Mesh(new T.ShapeGeometry(shape), this.material({ opacity: 0.35, ...s }))
    mesh.position.z = s.height ?? 0.03
    mesh.renderOrder = s.xray ? 10 : 1
    return this.add(mesh)
  }

  /** Translucent prism over a polygon (highlight a whole room in dollhouse view). */
  volume(points: XY[], s: FillStyle & { top?: number } = {}): THREENS.Mesh {
    const T = this.THREE
    const shape = new T.Shape(points.map(([x, y]) => new T.Vector2(x, y)))
    const depth = (s.top ?? 2.4) - (s.height ?? 0.02)
    const mesh = new T.Mesh(new T.ExtrudeGeometry(shape, { depth, bevelEnabled: false }), this.material({ opacity: 0.18, ...s }))
    mesh.position.z = s.height ?? 0.02
    return this.add(mesh)
  }

  /** Tube along a polyline (routes, wall paths, outlines). */
  path(points: XY[], s: PathStyle = {}): THREENS.Mesh | null {
    const T = this.THREE
    const h = s.height ?? 0.12
    const pts = points.map(([x, y]) => new T.Vector3(x, y, h))
    if (s.closed && pts.length > 2) pts.push(pts[0].clone())
    if (pts.length < 2) return null
    const curve = new T.CurvePath<THREENS.Vector3>()
    for (let i = 1; i < pts.length; i++) {
      if (pts[i].distanceTo(pts[i - 1]) > 1e-3) curve.add(new T.LineCurve3(pts[i - 1], pts[i]))
    }
    if (!curve.curves.length) return null
    const geo = new T.TubeGeometry(curve, Math.max(8, curve.curves.length * 4), s.radius ?? 0.06, 8, false)
    const mesh = new T.Mesh(geo, this.material(s, '#22d3ee'))
    mesh.renderOrder = s.xray ? 11 : 2
    return this.add(mesh)
  }

  /** A point marker: exits, victims, fire, door queues. */
  marker(at: XY, s: MarkerStyle = {}): THREENS.Mesh {
    const T = this.THREE
    const r = s.radius ?? 0.2
    const size = s.size ?? 2
    let geo: THREENS.BufferGeometry
    let z = s.height ?? 0
    switch (s.shape ?? 'pillar') {
      case 'disc':
        geo = new T.CircleGeometry(r, 32)
        z = s.height ?? 0.05
        break
      case 'ring':
        geo = new T.RingGeometry(r * 0.75, r, 40)
        z = s.height ?? 0.06
        break
      case 'sphere':
        geo = new T.SphereGeometry(r, 20, 14)
        z = s.height ?? r
        break
      case 'cone':
        geo = new T.ConeGeometry(r, size, 20).rotateX(-Math.PI / 2).translate(0, 0, size / 2)
        break
      default:
        geo = new T.CylinderGeometry(r, r, size, 20).rotateX(Math.PI / 2).translate(0, 0, size / 2)
    }
    const mesh = new T.Mesh(geo, this.material({ opacity: 0.9, ...s }, '#22c55e'))
    mesh.position.set(at[0], at[1], z)
    mesh.renderOrder = s.xray ? 12 : 3
    return this.add(mesh)
  }

  /** Billboard text that always faces the camera. */
  label(at: XY, text: string, s: LabelStyle = {}): THREENS.Sprite {
    const T = this.THREE
    const px = 64
    const canvas = document.createElement('canvas')
    const ctx = canvas.getContext('2d')!
    ctx.font = `600 ${px}px system-ui, sans-serif`
    const w = Math.ceil(ctx.measureText(text).width) + px * 0.6
    canvas.width = w
    canvas.height = px * 1.5
    ctx.font = `600 ${px}px system-ui, sans-serif`
    if (s.background !== 'none') {
      ctx.fillStyle = s.background ?? 'rgba(15,17,21,0.78)'
      roundRect(ctx, 0, 0, canvas.width, canvas.height, px * 0.3)
    }
    ctx.fillStyle = s.color ?? '#ffffff'
    ctx.textBaseline = 'middle'
    ctx.fillText(text, px * 0.3, canvas.height / 2)
    const tex = new T.CanvasTexture(canvas)
    tex.colorSpace = T.SRGBColorSpace
    const sprite = new T.Sprite(new T.SpriteMaterial({ map: tex, transparent: true, depthTest: !(s.xray ?? true), depthWrite: false }))
    const size = s.size ?? 0.35
    sprite.scale.set((size * canvas.width) / canvas.height, size, 1)
    sprite.position.set(at[0], at[1], s.height ?? 1.6)
    sprite.renderOrder = 20
    return this.add(sprite)
  }

  /** A pool of instanced spheres (evac occupants, crews). Hidden until positioned. */
  dots(count: number, s: FillStyle & { radius?: number } = {}): DotSet {
    const T = this.THREE
    const mesh = new T.InstancedMesh(new T.SphereGeometry(s.radius ?? 0.18, 14, 10), this.material({ opacity: 1, ...s }, '#fde047'), count)
    mesh.instanceMatrix.setUsage(T.DynamicDrawUsage)
    mesh.frustumCulled = false
    mesh.renderOrder = s.xray ? 13 : 4
    this.add(mesh)
    const set = new DotSet(T, mesh, s.height ?? (s.radius ?? 0.18) + 0.05)
    for (let i = 0; i < count; i++) set.set(i, null)
    set.commit()
    return set
  }
}

export class DotSet {
  private readonly m: THREENS.Matrix4
  private readonly c: THREENS.Color
  constructor(THREE: THREE, readonly mesh: THREENS.InstancedMesh, private readonly height: number) {
    this.m = new THREE.Matrix4()
    this.c = new THREE.Color()
  }

  get count() {
    return this.mesh.count
  }

  /** Position dot i at a floor plan point, or hide it with null. Call commit() after a batch. */
  set(i: number, at: XY | null, height = this.height) {
    if (at) this.m.makeTranslation(at[0], at[1], height)
    else this.m.makeScale(0, 0, 0)
    this.mesh.setMatrixAt(i, this.m)
  }

  color(i: number, color: string) {
    this.mesh.setColorAt(i, this.c.set(color))
  }

  commit() {
    this.mesh.instanceMatrix.needsUpdate = true
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true
  }
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.arcTo(x + w, y, x + w, y + h, r)
  ctx.arcTo(x + w, y + h, x, y + h, r)
  ctx.arcTo(x, y + h, x, y, r)
  ctx.arcTo(x, y, x + w, y, r)
  ctx.fill()
}

function disposeTree(obj: THREENS.Object3D) {
  obj.traverse((o) => {
    const mesh = o as THREENS.Mesh
    mesh.geometry?.dispose()
    const mats = Array.isArray(mesh.material) ? mesh.material : mesh.material ? [mesh.material] : []
    for (const m of mats) {
      ;(m as THREENS.MeshBasicMaterial).map?.dispose()
      m.dispose()
    }
  })
}
