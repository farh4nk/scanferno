/**
 * Guided clips: the camera walks a route through the Matterport model by itself, so nobody has to click.
 *
 *   const tour = await api.tour(building.id, 'Office 110', { entry: 'd-e0seq4' })
 *   const clip = tourPlayer(showcase, overlay, floorplan, tour.in)      // tour.out is the way back out
 *   clip.onChange((e) => console.log(e.state, tour.in.steps[e.step].text))
 *   clip.play()
 *
 * A clip is a polyline (from `GET /buildings/{id}/tour`). We pick the Matterport sweep nearest each point
 * along it, preferring sweeps in the same room so the camera never hops through a wall, then fly from
 * sweep to sweep facing down the route. The route is drawn into the `tour` layer; captions come from the
 * clip's steps and are reported through `onChange`.
 */
import { nearestAlong, pathLength, pointAlong } from './draw/paths'
import type { Overlay } from './overlay'
import { roomAt } from './picking'
import type { Showcase } from './showcase'
import type { Floorplan, TourClip, XY } from './types'
import { sweeps } from './walk'

/** A camera stop: stand on `sweepId`, `s` meters along the route, looking at `look`. */
export interface Shot {
  sweepId: string
  s: number
  at: XY
  look: XY
}

export type TourState = 'idle' | 'loading' | 'playing' | 'paused' | 'done' | 'error'

export interface TourEvent {
  state: TourState
  /** Index into clip.steps of the caption to show. */
  step: number
  /** 0..1 along the route. */
  progress: number
  message?: string
}

export interface TourPlayer {
  readonly clip: TourClip
  readonly state: TourState
  /** Playback speed multiplier; takes effect on the next hop. */
  speed: number
  /** Start, resume after pause, or replay when finished. */
  play(): void
  pause(): void
  restart(): void
  /** Jump to a caption (index into clip.steps) and keep playing from there. */
  seekStep(i: number): void
  /** Cancel and remove the route from the model. */
  stop(): void
  onChange(cb: (e: TourEvent) => void): () => void
}

const SAMPLE_M = 1.5
const MAX_SNAP_M = 4
const OTHER_ROOM_PENALTY_M = 3
const LOOK_AHEAD_M = 3.5
const WALK_MPS = 2.4
const COLORS = { in: '#38bdf8', out: '#22c55e' }

/** Camera stops along a clip, in order. Empty if the model has no usable sweeps near the route. */
export async function planShots(showcase: Showcase, overlay: Overlay, fp: Floorplan, clip: TourClip): Promise<Shot[]> {
  const all = await sweeps(showcase)
  const stops = all.map((sw) => {
    const at = overlay.toLocal(sw.position)
    return { id: sw.id, at, room: roomAt(fp, at)?.id ?? null }
  })
  const line = clip.polyline
  const total = pathLength(line)
  const n = Math.max(1, Math.ceil(total / SAMPLE_M))
  const shots: Shot[] = []
  let room: string | null = null
  let lastS = -Infinity
  for (let i = 0; i <= n; i++) {
    const p = pointAlong(line, (total * i) / n)
    room = roomAt(fp, p)?.id ?? room
    let best: (typeof stops)[number] | null = null
    let bestScore = Infinity
    for (const c of stops) {
      const d = Math.hypot(c.at[0] - p[0], c.at[1] - p[1])
      const score = d + (room && c.room !== room ? OTHER_ROOM_PENALTY_M : 0)
      if (d <= MAX_SNAP_M && score < bestScore) {
        best = c
        bestScore = score
      }
    }
    if (!best) continue
    const s = nearestAlong(line, best.at)
    // each stop must be a new sweep further along the route, or the camera would shuffle back and forth
    if (shots.length && (best.id === shots[shots.length - 1].sweepId || s <= lastS + 0.3)) continue
    shots.push({ sweepId: best.id, s, at: best.at, look: pointAlong(line, Math.min(total, s + LOOK_AHEAD_M)) })
    lastS = s
  }
  return shots
}

/** Index of the caption to show when the camera is `s` meters along (the next step within reach). */
export function stepAt(clip: TourClip, s: number, reach = 1.5): number {
  let idx = 0
  clip.steps.forEach((st, i) => {
    if (st.at_m <= s + reach) idx = i
  })
  return idx
}

export function tourPlayer(showcase: Showcase, overlay: Overlay, fp: Floorplan, clip: TourClip, opts: { layer?: string; color?: string } = {}): TourPlayer {
  const { sdk } = showcase
  const name = opts.layer ?? 'tour'
  const color = opts.color ?? COLORS[clip.kind]
  const total = pathLength(clip.polyline)
  const listeners = new Set<(e: TourEvent) => void>()
  let shots: Shot[] | null = null
  let state: TourState = 'idle'
  let run = 0
  let speed = 1
  let step = 0
  let progress = 0
  let yaw = 0
  let paused: Promise<void> | null = null
  let resume: (() => void) | null = null

  const emit = (message?: string) => listeners.forEach((cb) => cb({ state, step, progress, message }))
  const set = (s: TourState, message?: string) => {
    state = s
    emit(message)
  }

  function drawRoute() {
    const layer = overlay.layer(name)
    layer.clear()
    layer.path(clip.polyline, { color, radius: 0.07, opacity: 0.95 })
    layer.path(clip.polyline, { color, radius: 0.05, opacity: 0.35, xray: true })
    const n = Math.max(1, Math.round(total / 3))
    const dots = layer.dots(n, { color: '#ffffff', radius: 0.1, height: 0.18 })
    layer.tick((_dt, t) => {
      for (let i = 0; i < n; i++) dots.set(i, pointAlong(clip.polyline, (t * 1.4 + (i * total) / n) % total))
      dots.commit()
    })
    const first = clip.polyline[0]
    const last = clip.polyline[clip.polyline.length - 1]
    const door = clip.kind === 'in' ? first : last
    const room = clip.kind === 'in' ? last : first
    const doorSide = clip.steps.find((s) => s.door_id === clip.door_id)?.text.match(/side (\w)/)?.[1]
    layer.marker(door, { shape: 'pillar', radius: 0.25, size: 2.2, color: '#22c55e', opacity: 0.5, xray: true })
    layer.label(door, `${clip.kind === 'in' ? 'ENTRY' : 'EXIT'}${doorSide ? ` · side ${doorSide}` : ''}`, { height: 2.6, color: '#bbf7d0', size: 0.3 })
    layer.marker(room, { shape: 'cone', radius: 0.3, size: 0.8, height: 1.4, color: '#ef4444', xray: true })
    layer.label(room, 'TARGET', { height: 2.6, color: '#fecaca', size: 0.3 })
  }

  /** A ring and pillar on the next caption's spot, so the eye is led to the next door or corner. */
  function drawNext(i: number) {
    const layer = overlay.layer(`${name}-next`)
    layer.clear()
    const st = clip.steps[Math.min(i + 1, clip.steps.length - 1)]
    if (!st || st.at_m <= progress * total + 0.5) return
    layer.marker(st.xy, { shape: 'ring', radius: 0.45, color: '#ffffff', opacity: 0.9, xray: true })
    layer.marker(st.xy, { shape: 'pillar', radius: 0.05, size: 1.6, color: '#ffffff', opacity: 0.55, xray: true })
  }

  function clearAll() {
    overlay.layer(name).clear()
    overlay.layer(`${name}-next`).clear()
  }

  async function ensureInside() {
    const M = sdk.Mode.Mode
    try {
      await sdk.Mode.moveTo(M.INSIDE)
    } catch {
      // already inside, or the mode is disabled for this model; Sweep.moveTo below will still work
    }
  }

  const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

  async function go(fromS: number) {
    const mine = ++run
    set('loading')
    try {
      drawRoute()
      shots ??= await planShots(showcase, overlay, fp, clip)
      if (mine !== run) return
      if (!shots.length) {
        set('error', 'No 3D camera positions along this route')
        return
      }
      await ensureInside()
      const found = shots.findIndex((sh) => sh.s >= fromS - 0.5)
      let i = found < 0 ? shots.length - 1 : found
      set('playing')
      let from: XY | null = null
      for (; i < shots.length; i++) {
        if (mine !== run) return
        if (paused) await paused
        if (mine !== run) return
        const sh = shots[i]
        const w = overlay.toWorld(sh.look)
        const sw = overlay.toWorld(sh.at)
        const dx = w.x - sw.x
        const dz = w.z - sw.z
        if (Math.hypot(dx, dz) > 0.5) yaw = (Math.atan2(-dx, -dz) * 180) / Math.PI
        progress = total > 0 ? Math.min(1, sh.s / total) : 1
        step = stepAt(clip, sh.s)
        drawNext(step)
        emit()
        const hop = from ? Math.hypot(sh.at[0] - from[0], sh.at[1] - from[1]) : 6
        const ms = Math.max(650, Math.min(2600, ((hop / WALK_MPS) * 1000) / speed))
        try {
          await sdk.Sweep.moveTo(sh.sweepId, { rotation: { x: -6, y: yaw }, transition: sdk.Camera.TransitionType.FLY, transitionTime: ms })
        } catch (e) {
          if (mine !== run) return
          set('error', `Camera could not move: ${(e as Error).message ?? e}`)
          return
        }
        from = sh.at
        await sleep(180 / speed)
      }
      if (mine !== run) return
      progress = 1
      step = clip.steps.length - 1
      overlay.layer(`${name}-next`).clear()
      set('done')
    } catch (e) {
      if (mine === run) set('error', String((e as Error).message ?? e))
    }
  }

  return {
    clip,
    get state() {
      return state
    },
    get speed() {
      return speed
    },
    set speed(v: number) {
      speed = v > 0 ? v : 1
    },
    play() {
      if (state === 'paused') {
        paused = null
        resume?.()
        resume = null
        set('playing')
      } else if (state !== 'playing' && state !== 'loading') {
        void go(state === 'done' ? 0 : progress * total)
      }
    },
    pause() {
      if (state !== 'playing') return
      paused = new Promise<void>((r) => (resume = r))
      set('paused')
    },
    restart() {
      paused = null
      resume?.()
      resume = null
      progress = 0
      void go(0)
    },
    seekStep(i: number) {
      paused = null
      resume?.()
      resume = null
      void go(clip.steps[Math.max(0, Math.min(i, clip.steps.length - 1))].at_m)
    },
    stop() {
      run++
      paused = null
      resume?.()
      resume = null
      clearAll()
      progress = 0
      step = 0
      set('idle')
    },
    onChange(cb) {
      listeners.add(cb)
      return () => listeners.delete(cb)
    },
  }
}
