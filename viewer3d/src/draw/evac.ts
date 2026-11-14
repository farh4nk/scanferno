/**
 * Play back GET /buildings/{id}/evac on the model: one dot per occupant, interpolated between the
 * simulation's 1 s frames, red discs at doors that have a queue (sized by queue length), and a ring on the
 * bottleneck door.
 */
import type { Layer } from '../overlay'
import type { Evac, Floorplan, XY } from '../types'

export interface EvacPlayer {
  play(): void
  pause(): void
  seek(t: number): void
  readonly time: number
  readonly duration: number
  readonly playing: boolean
  speed: number
  /** Called every frame while playing, and on seek. */
  onTime?: (t: number) => void
}

const lerp = (a: XY, b: XY, f: number): XY => [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f]

export function evacPlayer(layer: Layer, fp: Floorplan, evac: Evac, opts: { color?: string } = {}): EvacPlayer {
  const frames = evac.frames
  const n = evac.occupants
  const dots = layer.dots(n, { color: opts.color ?? '#fde047', radius: 0.16 })
  const doors = new Map(fp.doors.map((d) => [d.id, d]))
  const queueDoors = [...new Set(frames.flatMap((f) => Object.keys(f.queues)))].filter((id) => doors.has(id))
  const queueDiscs = new Map(queueDoors.map((id) => {
    const disc = layer.marker(doors.get(id)!.position, { shape: 'disc', radius: 1, color: '#ef4444', opacity: 0.55, height: 0.06 })
    disc.visible = false
    return [id, disc]
  }))
  const bottleneck = evac.bottleneck_door_id && doors.get(evac.bottleneck_door_id)
  if (bottleneck) {
    layer.marker(bottleneck.position, { shape: 'ring', radius: 0.9, color: '#ef4444', opacity: 0.9 })
    layer.label(bottleneck.position, `Bottleneck: peak ${evac.peak_queue[bottleneck.id] ?? 0}`, { height: 2.2, color: '#fecaca', size: 0.3 })
  }
  const duration = Math.max(evac.clear_time_s, frames.length ? frames[frames.length - 1].t : 0)

  const render = (t: number) => {
    let i = 0
    while (i < frames.length - 1 && frames[i + 1].t <= t) i++
    const a = frames[i]
    const b = frames[Math.min(i + 1, frames.length - 1)]
    const f = b.t > a.t ? Math.min(1, (t - a.t) / (b.t - a.t)) : 0
    for (let k = 0; k < n; k++) {
      const pa = a?.agents[k] ?? null
      const pb = b?.agents[k] ?? null
      dots.set(k, pa && pb ? lerp(pa, pb, f) : t >= duration ? null : pa)
    }
    dots.commit()
    for (const [id, disc] of queueDiscs) {
      const q = a?.queues[id] ?? 0
      disc.visible = q > 0
      const r = 0.3 + 0.18 * q
      disc.scale.set(r, r, 1)
    }
  }

  const state = { time: 0, playing: false, speed: 1 }
  const player: EvacPlayer = {
    play() {
      if (state.time >= duration) state.time = 0
      state.playing = true
    },
    pause() {
      state.playing = false
    },
    seek(t) {
      state.time = Math.max(0, Math.min(duration, t))
      render(state.time)
      player.onTime?.(state.time)
    },
    get time() { return state.time },
    get duration() { return duration },
    get playing() { return state.playing },
    get speed() { return state.speed },
    set speed(v) { state.speed = v },
  }
  layer.tick((dt) => {
    if (!state.playing) return
    state.time = Math.min(duration, state.time + dt * state.speed)
    if (state.time >= duration) state.playing = false
    render(state.time)
    player.onTime?.(state.time)
  })
  render(0)
  return player
}
