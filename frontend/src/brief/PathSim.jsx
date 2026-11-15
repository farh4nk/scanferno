import { useEffect, useMemo, useRef, useState } from 'react'
import { getSimulation } from '../api'
import Viewer3D from '../components/Viewer3D'
import Icon from '../ui/Icon'
import PlanSvg from './PlanSvg'

// Path simulation: one animated run for the whole search. In through the entry door, every room of the
// search plan in order (each one ticks off as the crew reaches it), then out the nearest exit.
// 2D animates here; "3D model" hands the same run to the Matterport player as one guided clip.

const MPS = 3.5 // animation pace at 1x, meters of plan per second
const DWELL_MS = 600 // pause inside each room while it is "checked"
const SPEEDS = [1, 2, 4]
const LEG_CLASS = { in: 'in', search: '', out: 'out' }

// part of a polyline between two distances along it
function between(pts, from, to) {
  const out = []
  let s = 0
  for (let i = 1; i < pts.length; i++) {
    const [ax, ay] = pts[i - 1]; const [bx, by] = pts[i]
    const seg = Math.hypot(bx - ax, by - ay)
    const a = Math.max(from, s); const b = Math.min(to, s + seg)
    if (seg > 0 && b > a) {
      const at = (d) => [ax + ((bx - ax) * (d - s)) / seg, ay + ((by - ay) * (d - s)) / seg]
      if (!out.length) out.push(at(a))
      out.push(at(b))
    }
    s += seg
  }
  return out
}
const pointAt = (pts, d) => { const p = between(pts, d, d + 1e-6); return p[0] || pts[pts.length - 1] }
const fmt = (m) => `${Math.round(m)} m`

export default function PathSim({ k, building, plan, briefing, onClose }) {
  const rooms = useMemo(() => k.plan_.map((s) => s.room_id), [k.plan_])
  const fire = k.fireIds
  const [entry, setEntry] = useState(null)
  const [sim, setSim] = useState(null)
  const [err, setErr] = useState(null)
  const [s, setS] = useState(0)
  const [playing, setPlaying] = useState(true)
  const [speed, setSpeed] = useState(1)
  const [view, setView] = useState('2d')
  const sRef = useRef(0)
  const dwell = useRef(0)

  // one request per search plan / entry door; a new plan (live call) restarts the run
  useEffect(() => {
    if (!rooms.length) return undefined
    let alive = true
    setErr(null)
    getSimulation(building.id, rooms, { entry: entry || k.search?.door_id || undefined, avoid: fire })
      .then((r) => { if (!alive) return; setSim(r); sRef.current = 0; dwell.current = 0; setS(0); setPlaying(true) })
      .catch((e) => alive && setErr(e.message))
    return () => { alive = false }
  }, [building.id, rooms.join(), entry, fire.join()]) // eslint-disable-line react-hooks/exhaustive-deps

  // the 2D animation: walk the polyline, stop in each room for a moment
  useEffect(() => {
    if (!sim || !playing || view !== '2d') return undefined
    let raf; let last = performance.now()
    const tick = (now) => {
      const dt = Math.min(0.1, (now - last) / 1000); last = now
      if (dwell.current > 0) dwell.current -= dt * 1000
      else {
        let next = sRef.current + MPS * speed * dt
        const stop = sim.stops.find((st) => st.at_m > sRef.current + 1e-6 && st.at_m <= next)
        if (stop) { next = stop.at_m; dwell.current = DWELL_MS / speed }
        if (next >= sim.total_m) { next = sim.total_m; setPlaying(false) }
        sRef.current = next; setS(next)
      }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [sim, playing, speed, view])

  const seek = (d) => { sRef.current = d; dwell.current = 0; setS(d) }
  const clip = useMemo(() => (sim ? { data: sim.clip, label: 'Path simulation' } : null), [sim])

  if (err) return <div className="stage panel"><p className="caption err">{err}</p><button className="btn" onClick={onClose}>Close</button></div>
  if (!sim) return <div className="stage panel"><p className="muted" style={{ padding: 24 }}>Building the run…</p></div>

  const here = sim.stops.find((st) => Math.abs(st.at_m - s) < 0.01)
  const done = sim.stops.filter((st) => st.at_m < s - 0.001)
  const checked = new Set(done.map((st) => st.room_id))
  const order = Object.fromEntries(sim.stops.filter((st) => !checked.has(st.room_id)).map((st) => [st.room_id, st.order]))
  const walked = sim.legs.map((l) => ({ polyline: between(l.polyline, 0, Math.max(0, s - l.start_m)), cls: LEG_CLASS[l.kind] })).filter((r) => r.polyline.length > 1)
  const ahead = between(sim.polyline, s, sim.total_m)
  const phase = s > sim.legs.at(-1).start_m + 0.01 ? 'out' : s < sim.in_m - 0.01 ? 'in' : 'search'
  const step = sim.clip.steps.reduce((acc, st, i) => (st.at_m <= s + 0.01 ? i : acc), 0)
  const caption = s >= sim.total_m ? sim.clip.steps.at(-1).text : sim.clip.steps[step].text
  const nextStop = sim.stops.find((st) => st.at_m > s + 0.01)
  const prevStop = [...sim.stops].reverse().find((st) => st.at_m < s - 0.01)
  const finished = s >= sim.total_m
  const tags = [
    { at: sim.entry.position, dy: 44, text: `ENTER · SIDE ${sim.entry.side}`, cls: 'f' },
    { at: sim.exit.position, dy: -44, text: `EXIT · SIDE ${sim.exit.side}`, cls: 'f' },
  ]
  const jumpTo = (d) => { setPlaying(false); seek(d) }

  return (
    <>
      <div className="stage panel simstage">
        <div className="seg stage-mode"><button className={view === '2d' ? 'on' : ''} onClick={() => setView('2d')}>2D plan</button><button className={view === '3d' ? 'on' : ''} onClick={() => setView('3d')}>3D model</button></div>
        <div className="planwrap simplan">
          {view === '3d'
            ? <Viewer3D building={building} plan={plan} layers={{ order: false, routes: false, doors: true, heat: false, windows: false }}
                searchOrder={{}} trapped={briefing.trapped || []} fireRooms={briefing.fire_room_ids} selected={null} onSelect={() => {}}
                highlight={null} mayday={null} evac={null} clip={clip} onClipClose={() => setView('2d')} />
            : <PlanSvg plan={plan} k={k} order={order} checked={checked} rescueRoutes={walked} dashed={ahead.length > 1 ? ahead : null}
                agents={[pointAt(sim.polyline, s)]} tags={tags} sides={false} />}
        </div>
        {view === '2d' && (
          <div className={`simbar ${phase}`}>
            <div className="simcap" aria-live="polite"><span className="simphase">{phase === 'in' ? 'In' : phase === 'out' ? 'Out' : `Room ${here?.order ?? nextStop?.order ?? sim.stops.length} of ${sim.stops.length}`}</span>{caption}</div>
            <input className="simscrub" type="range" min={0} max={sim.total_m} step={0.1} value={s} aria-label="Position along the run"
              onChange={(e) => jumpTo(+e.target.value)} />
            <div className="tour-ctl">
              <button disabled={!prevStop} onClick={() => jumpTo(prevStop.at_m)} aria-label="Previous room"><Icon name="prev" /></button>
              <button className="f" onClick={() => { if (finished) { seek(0); setPlaying(true) } else setPlaying((p) => !p) }} aria-label={finished ? 'Replay' : playing ? 'Pause' : 'Play'}>
                <Icon name={finished ? 'play' : playing ? 'pause' : 'play'} />
              </button>
              <button disabled={!nextStop} onClick={() => jumpTo(nextStop.at_m)} aria-label="Next room"><Icon name="next" /></button>
              <span className="muted small">{fmt(s)} of {fmt(sim.total_m)}</span>
              <span className="sp" />
              {SPEEDS.map((v) => <button key={v} className={speed === v ? 'on' : ''} onClick={() => setSpeed(v)}>{v}×</button>)}
            </div>
          </div>
        )}
      </div>
      <div className="side" id="side-panel">
        <div className="sign"><div>
          <small>Path simulation</small>
          <div className="big">{sim.rooms.length} rooms · {fmt(sim.total_m)}</div>
          <div className="sub">in {fmt(sim.in_m)} · search {fmt(sim.search_m)} · out {fmt(sim.out_m)}</div>
        </div></div>
        <div className="card">
          <h3>Enter by <span>the way out is the nearest exit to the last room</span></h3>
          <select className="sel" style={{ margin: 0 }} value={sim.entry.door_id} onChange={(e) => setEntry(e.target.value)} aria-label="Entry door">
            {sim.entries.map((e) => <option key={e.door_id} value={e.door_id}>Side {e.side} door · {fmt(e.distance_m)} to the first room</option>)}
          </select>
        </div>
        <div className="card simlist">
          <h3>Rooms in order <span>tap to jump</span></h3>
          {sim.stops.map((st) => {
            const state = checked.has(st.room_id) ? 'done' : here?.room_id === st.room_id ? 'now' : ''
            const why = k.plan_.find((p) => p.room_id === st.room_id)?.reason
            return (
              <button key={st.room_id} className={`simrow ${state} ${st.fire ? 'fire' : ''}`} onClick={() => jumpTo(st.at_m)}>
                <i>{state === 'done' ? '✓' : st.order}</i><div><b>{st.label}</b>{why && <small>{why}</small>}</div><span>{fmt(st.at_m)}</span>
              </button>
            )
          })}
          <button className={`simrow exit ${finished ? 'now' : ''}`} onClick={() => jumpTo(sim.total_m)}>
            <i><Icon name="arrow" /></i><div><b>Exit plan</b><small>Side {sim.exit.side} door, {fmt(sim.out_m)} from {sim.stops.at(-1).label}</small></div><span>{fmt(sim.total_m)}</span>
          </button>
        </div>
        <button className="btn wide" style={{ flex: 'none' }} onClick={onClose}>Close simulation</button>
      </div>
    </>
  )
}
