// One page per job. Each page does one thing; the home briefing links here for detail.
import { useEffect, useMemo, useRef, useState } from 'react'
import { ask, asset, getEvac, getMayday } from '../api'
import PlanSvg from '../brief/PlanSvg'
import { HoseGauge, Ring, Section } from '../brief/Diagrams'
import LivePanel from '../components/LivePanel'
import Viewer3D from '../components/Viewer3D'
import Icon from '../ui/Icon'

const fmt = (t) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`
const show = (v) => (Array.isArray(v) ? v.map((x) => (typeof x === 'object' ? x.location || x.description : x)).join('; ') : v == null ? '' : String(v))

// ---------- Call ----------
export function CallPage({ ctx }) {
  const { feed, source, switchSource, calls, callId, setCallId, speed, setSpeed, startCall, stopCall, running, listen, caps, onSaved } = ctx
  const box = useRef(null)
  useEffect(() => { if (box.current) box.current.scrollTop = box.current.scrollHeight }, [feed.utterances.length])
  return (
    <div className="page split" style={{ gridTemplateColumns: '1fr 400px' }}>
      <div className="panel" ref={box}>
        <h2>Transcript <span>{feed.status}</span></h2>
        {feed.utterances.length ? feed.utterances.map((u, i) => (
          <div key={i} className={`utt ${u.role} ${ctx.seek ? 'seekable' : ''}`} onClick={ctx.seek ? () => ctx.seek(u.start) : undefined} title={ctx.seek ? 'Jump here' : undefined}><span className="t">{u.start != null ? fmt(u.start) : ''}</span><div><div className="who">{u.role}</div>{u.text}</div></div>
        )) : <p className="empty">{source === 'live' ? 'Listen with the mic, upload a recording, or type a line.' : 'Pick a call and press Play. Lines appear as the caller speaks, and every page updates as facts come in.'}</p>}
        {feed.interim && <div className="utt caller interim"><span className="t" /><div><div className="who">…</div>{feed.interim}</div></div>}
      </div>
      <div className="col">
        <div className="panel">
          <h2>Source</h2>
          <div className="seg"><button className={source === 'replay' ? 'on' : ''} onClick={() => switchSource('replay')}>Replay</button><button className={source === 'live' ? 'on' : ''} onClick={() => switchSource('live')}>Live</button></div>
          {source === 'replay' && <>
            <select className="sel" value={callId} onChange={(e) => setCallId(e.target.value)} disabled={!calls.length}>
              {!calls.length && <option value="">No scripted calls for this building</option>}
              {calls.map((c) => <option key={c.call_id} value={c.call_id}>{c.title.replace(/^[^:]+: /, '')}{c.has_audio ? '' : ' (no audio)'}</option>)}
            </select>
            <div className="row-btns">
              {running ? <button className="btn wide" onClick={stopCall}><Icon name="stop" />Close call</button>
                : <button className="btn f wide" onClick={startCall} disabled={!callId}><Icon name="play" />Play call</button>}
              <div className="seg">{[1, 2, 4].map((s) => <button key={s} className={speed === s ? 'on' : ''} onClick={() => setSpeed(s)}>{s}×</button>)}</div>
            </div>
          </>}
        </div>
        {source === 'live' && <LivePanel listen={listen} stt={caps.stt} onSaved={onSaved} />}
      </div>
    </div>
  )
}

// ---------- Dispatch facts ----------
const FIELDS = [['address', 'Address'], ['floor', 'Floor'], ['side', 'Fire side'], ['fire_location', 'Fire location'], ['conditions', 'Conditions'],
  ['trapped', 'Trapped'], ['hazards', 'Hazards'], ['caller_location', 'Caller is'], ['cross_street', 'Cross street']]
export function FactsPage({ ctx }) {
  const r = ctx.feed.record; const c = r?.confidence || {}; const ch = new Set(r?.changed || []); const corr = r?.corrections || {}
  return (
    <div className="page split" style={{ gridTemplateColumns: '1fr 380px' }}>
      <div className="panel">
        <h2>Dispatch record <span>{r ? `update ${ctx.feed.recordN}` : 'waiting for a call'}</span></h2>
        {FIELDS.map(([k, l]) => {
          const was = corr[k]?.at(-1)?.from
          return (
            <div key={`${k}-${ch.has(k) ? ctx.feed.recordN : 0}`} className={`kv ${ch.has(k) ? 'flash' : ''}`}>
              <span className="k">{l}</span>
              <span className={`v ${r?.[k] == null || r?.[k]?.length === 0 ? 'none' : ''}`}>{was != null && <s className="was">{show(was)}</s>}{show(r?.[k]) || '–'}</span>
              <span>{c[k] != null && <><div className="bar"><i style={{ width: `${c[k] * 100}%` }} /></div><span className="note">{Math.round(c[k] * 100)}% sure</span></>}</span>
            </div>
          )
        })}
      </div>
      <div className="panel"><h2>How this works</h2><p className="note big">Each caller line is turned into these fields. Bars show how sure the extractor is; a field flashes when the caller changes it, and a struck-out value is what they corrected.</p>
        {r && <p className="note">Extractor: {r.extractor}</p>}</div>
    </div>
  )
}

// ---------- Rescue ----------
export function RescuePage({ ctx, k }) {
  const [picked, setPicked] = useState(ctx.params.room || null)
  // follow the trapped person until the officer picks a room themselves
  const sel = picked || k.victim || k.plan_[0]?.room_id; const setSel = setPicked
  const rt = sel && k.routeOf(sel)
  return (
    <div className="page split" style={{ gridTemplateColumns: '500px 1fr' }}>
      <div className="col">
        {k.victim ? <div className="sign r"><div className="trow">{k.victimConf != null && <Ring p={k.victimConf} />}<div><small>Trapped · from the caller</small><div className="big">{k.victimLabel}</div>{k.victimWords && <div className="sub">“{k.victimWords}”</div>}</div></div></div>
          : <div className="sign"><div><small>Trapped</small><div className="big">Not reported yet</div></div></div>}
        <div className="panel grow"><h2>Search order <span>tap a room</span></h2>
          {k.plan_.map((s, i) => (
            <button key={s.room_id} className={`row ${s.room_id === sel ? 'sel' : ''}`} onClick={() => setSel(s.room_id)}>
              <span className={`sh ${s.room_id === k.victim ? 'r' : ''}`}>{i + 1}</span><div><b>{k.label(s.room_id)}</b><small>{s.reason}</small></div>
              <span className="d">{k.routeOf(s.room_id) ? `${k.routeOf(s.room_id).distance_m} m` : ''}</span>
            </button>
          ))}
        </div>
      </div>
      <div className="panel col"><h2>{k.label(sel)} <span>{rt ? `${rt.distance_m} m to the exit${rt.rerouted ? ', rerouted around the fire' : ''}` : 'no route'}</span></h2>
        <div className="grow"><PlanSvg plan={ctx.plan} k={k} selected={sel} onSelect={setSel} routes={rt ? [rt.polyline] : []} order={Object.fromEntries(k.plan_.map((s, i) => [s.room_id, i + 1]))} /></div></div>
    </div>
  )
}

// ---------- Entry ----------
export function EntryPage({ ctx, k }) {
  const [sel, setSel] = useState(k.search?.door_id)
  const e = ctx.briefing.entry_points || []
  return (
    <div className="page split" style={{ gridTemplateColumns: '1fr 1fr' }}>
      <div className="panel"><h2>Entry doors <span>{e.length}</span></h2>
        {e.map((x) => (
          <button key={x.door_id} className={`row ${sel === x.door_id ? 'sel' : ''}`} onClick={() => setSel(x.door_id)}>
            <span className={`sh ${x.role ? '' : 'o'}`}>{x.side}</span>
            <div><b>{x.role ? `${x.role[0].toUpperCase()}${x.role.slice(1)} door` : 'Door'}</b><small>{x.text.replace(/^Side \w: /, '')}</small></div>
            <span className="src">{(x.sources || []).join(' + ')}</span>
          </button>
        ))}
      </div>
      <div className="panel col"><h2>Doors <span>white squares are exits</span></h2><div className="grow"><PlanSvg plan={ctx.plan} k={k} hiDoors={[sel]} bigExits /></div></div>
    </div>
  )
}

// ---------- Hazards ----------
export function HazardsPage({ ctx }) {
  const hz = ctx.briefing.hazards || []; const srcs = [...new Set(hz.map((h) => h.source))]; const [on, setOn] = useState(null)
  const counts = ['high', 'med', 'low'].map((s) => [s, hz.filter((h) => h.severity === s).length])
  return (
    <div className="page split" style={{ gridTemplateColumns: '1fr 340px' }}>
      <div className="panel"><h2>Hazards <span>{hz.length}</span></h2>
        <div className="chips">{[null, ...srcs].map((s) => <button key={s || 'all'} className={`chip ${on === s ? 'on' : ''}`} onClick={() => setOn(s)}>{s || 'All'}</button>)}</div>
        {hz.filter((h) => !on || h.source === on).map((h, i) => (
          <div key={i} className="row"><span className={`sh ${h.severity === 'high' ? 'r' : 'o'}`}>!</span><div><b>{h.text}</b><small>{h.severity} · {h.kind.replace(/_/g, ' ')}</small></div><span className="src">{h.source}</span></div>
        ))}
      </div>
      <div className="panel"><h2>By severity</h2>
        {counts.map(([s, n]) => <div key={s} className="sev"><span>{s}</span><div className="bar big"><i className={s} style={{ width: `${hz.length ? n / hz.length * 100 : 0}%` }} /></div><b>{n}</b></div>)}
      </div>
    </div>
  )
}

// ---------- Hose ----------
export function HosePage({ ctx, k }) {
  const hs = ctx.briefing.hose_stretch || []
  return (
    <div className="page split" style={{ gridTemplateColumns: '1fr 1fr' }}>
      <div className="panel"><h2>Hose stretch <span>200 ft preconnect</span></h2>
        {hs.map((h, i) => (
          <div key={i} className="hoserow"><div className="hh"><b>Side {h.side} door → {k.label(h.to_room_id)}</b><span>{h.interior_m} m inside</span></div><HoseGauge ft={h.total_ft} /></div>
        ))}
        {!hs.length && <p className="empty">No fire location yet, so no hose stretch.</p>}
      </div>
      <div className="panel col"><h2>Shortest stretch</h2><div className="grow">{hs[0] && <PlanSvg plan={ctx.plan} k={k} hose={k.routeOf(hs[0].to_room_id) ? [...k.routeOf(hs[0].to_room_id).polyline].reverse() : null} />}</div></div>
    </div>
  )
}

// ---------- Exterior ----------
export function ExteriorPage({ ctx, k }) {
  const b = ctx.briefing
  return (
    <div className="page split" style={{ gridTemplateColumns: '1fr 1fr' }}>
      <div className="col"><div className="panel"><h2>Building</h2><Section k={k} /></div>
        <div className="panel"><h2>Ladders</h2>{(b.ladder_positions || []).map((l, i) => <div key={i} className="row"><span className="sh">{l.side}</span><div><b>{l.purpose}</b><small>{l.text}</small></div><span className="src">{(l.sources || []).join(' + ')}</span></div>)}</div></div>
      <div className="panel"><h2>Know before you trust it</h2>{k.caveats.map((c, i) => <div key={i} className="row one"><span>{c}</span></div>)}</div>
    </div>
  )
}

// ---------- Aerial photos ----------
export function AerialPage({ ctx, k }) {
  const imgs = ctx.briefing.images || {}; const [v, setV] = useState(k.frontView in imgs ? k.frontView : Object.keys(imgs)[0])
  return (
    <div className="page"><div className="panel col full">
      <div className="seg">{Object.keys(imgs).map((x) => <button key={x} className={v === x ? 'on' : ''} onClick={() => setV(x)}>{x === 'nadir' ? 'top-down' : x.replace('oblique-', 'from the ')}</button>)}</div>
      {imgs[v] ? <img className="aer" src={asset(imgs[v])} alt={`Aerial ${v}`} /> : <p className="empty">No aerial images for this building.</p>}
    </div></div>
  )
}

// ---------- Floor plan (2D / 3D) ----------
const LAYERS = [['order', 'Search order'], ['routes', 'Exit routes'], ['doors', 'Doors'], ['heat', 'Maze heat']]
export function PlanPage({ ctx, k, go, start3d = false }) {
  const [mode, setMode] = useState(start3d || ctx.params.mode === '3d' ? '3d' : '2d'); const [sel, setSel] = useState(null)
  const [L, setL] = useState({ order: true, routes: true, doors: true, heat: false, windows: false })
  const order = L.order ? Object.fromEntries(k.plan_.map((s, i) => [s.room_id, i + 1])) : null
  const md = sel && ctx.plan.maze_detail?.[sel]
  const routes = L.routes ? (sel ? [k.routeOf(sel)?.polyline] : k.victim ? [k.vRoute?.polyline] : []).filter(Boolean) : []
  return (
    <div className="page split" style={{ gridTemplateColumns: '1fr 340px' }}>
      <div className="col">
        <div className="chips">
          <div className="seg"><button className={mode === '2d' ? 'on' : ''} onClick={() => setMode('2d')}>2D</button><button className={mode === '3d' ? 'on' : ''} onClick={() => setMode('3d')}>3D model</button></div>
          {LAYERS.map(([key, l]) => <button key={key} className={`chip ${L[key] ? 'on' : ''}`} onClick={() => setL({ ...L, [key]: !L[key] })}>{l}</button>)}
        </div>
        <div className="grow panel flat">
          {mode === '3d'
            ? <Viewer3D building={ctx.building} plan={ctx.plan} layers={L} searchOrder={order || {}} trapped={ctx.briefing.trapped || []} fireRooms={ctx.briefing.fire_room_ids}
                selected={sel} onSelect={setSel} highlight={null} mayday={ctx.feed.mayday} evac={null} />
            : <PlanSvg plan={ctx.plan} k={k} selected={sel} onSelect={setSel} order={order} doors={L.doors} heat={L.heat} routes={routes} />}
        </div>
      </div>
      <div className="panel">
        {sel ? <>
          <h2>Selected room</h2><div className="title">{k.label(sel)}</div>
          <p className="note">{k.R[sel].type} · {k.R[sel].area_m2} m² · side {k.R[sel].side}</p>
          <div className="maze"><span>Maze score</span><div className="bar big"><i style={{ width: `${(ctx.plan.maze_score?.[sel] || 0) * 100}%` }} /></div><b>{(ctx.plan.maze_score?.[sel] || 0).toFixed(2)}</b></div>
          {(md?.why || []).map((w, i) => <div key={i} className="row one"><span>{w}</span></div>)}
          <button className="btn red wide" onClick={() => go('mayday', { room: sel })}>Mayday from here<Icon name="arrow" /></button>
        </> : <><h2>Floor plan</h2><p className="note big">Tap any room for its maze score, exit route and mayday directions.</p></>}
      </div>
    </div>
  )
}

// 3D model: the same page, opened straight into the Matterport model
export const ModelPage = (props) => <PlanPage {...props} start3d />

// ---------- Mayday ----------
export function MaydayPage({ ctx, k }) {
  const [room, setRoom] = useState(ctx.params.room || ctx.feed.mayday?.from_room_id || k.deadEnd || k.plan_[0]?.room_id)
  const [m, setM] = useState(null); const [stepI, setStep] = useState(0); const [err, setErr] = useState(null)
  useEffect(() => { if (ctx.feed.mayday) setRoom(ctx.feed.mayday.from_room_id) }, [ctx.feed.mayday])
  useEffect(() => {
    if (!room) return; let alive = true; setErr(null); setStep(0)
    getMayday(ctx.buildingId, room).then((r) => alive && setM(r)).catch((e) => alive && setErr(e.message))
    return () => { alive = false; window.speechSynthesis?.cancel() }
  }, [room, ctx.buildingId])
  const say = (t) => { window.speechSynthesis?.cancel(); window.speechSynthesis?.speak(new SpeechSynthesisUtterance(t)) }
  const n = m?.directions?.length || 0; const wp = m?.wall_path || []; const cut = n ? Math.round(wp.length * stepI / n) : 0
  return (
    <div className="page split" style={{ gridTemplateColumns: '1fr 480px' }}>
      <div className="col">
        <select className="sel big" value={room} onChange={(e) => setRoom(e.target.value)}>
          {ctx.plan.rooms.filter((r) => r.type !== 'void').map((r) => <option key={r.id} value={r.id}>Last known room: {r.label} · side {r.side}</option>)}
        </select>
        {err && <p className="err">{err}</p>}
        {m && <>
          <div className="sign"><div><small>Hand on wall</small><div className="big">{m.hand[0].toUpperCase() + m.hand.slice(1)} hand · {m.distance_m} m to side {m.exit_side} exit</div><div className="sub">Passes {m.doors_passed} door{m.doors_passed === 1 ? '' : 's'} · shortest path {m.shortest_m} m</div></div></div>
          <div className="panel grow steps">{m.directions.map((d, i) => <button key={i} className={`st ${i < stepI ? 'done' : i === stepI ? 'now' : ''}`} onClick={() => setStep(i)}><i>{i + 1}</i>{d}</button>)}</div>
        </>}
      </div>
      <div className="col">
        <div className="panel grow flat">{m && <PlanSvg plan={ctx.plan} k={k} selected={room} dashed={wp.slice(Math.max(cut - 1, 0))} walked={cut > 1 ? wp.slice(0, cut) : null} />}</div>
        <div className="row-btns">
          <button className="btn" onClick={() => setStep(Math.max(0, stepI - 1))} disabled={!stepI} aria-label="Previous step"><Icon name="back" /></button>
          <button className="btn wide" onClick={() => m && say(m.directions[stepI])}><Icon name="speak" />Speak step</button>
          <button className="btn f wide" onClick={() => setStep(Math.min(n - 1, stepI + 1))} disabled={stepI >= n - 1}>Next step<Icon name="arrow" /></button>
        </div>
      </div>
    </div>
  )
}

// ---------- Evacuation ----------
export function EvacPage({ ctx, k }) {
  const [occ, setOcc] = useState(30); const [res, setRes] = useState(null); const [t, setT] = useState(0); const [playing, setPlaying] = useState(false); const [err, setErr] = useState(null)
  const run = () => { setErr(null); getEvac(ctx.buildingId, occ).then((r) => { setRes(r); setT(0); setPlaying(true) }).catch((e) => setErr(e.message)) }
  useEffect(() => { run() }, [ctx.buildingId]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!playing || !res) return undefined
    const id = setInterval(() => setT((x) => { if (x >= res.frames.length - 1) { setPlaying(false); return x } return x + 1 }), 400)
    return () => clearInterval(id)
  }, [playing, res])
  const fr = res?.frames?.[t]; const out = fr ? fr.agents.filter((a) => !a).length : 0
  return (
    <div className="page split" style={{ gridTemplateColumns: '1fr 340px' }}>
      <div className="panel flat">{fr && <PlanSvg plan={ctx.plan} k={k} agents={fr.agents} victim={false} />}</div>
      <div className="col">
        <div className="panel"><h2>Evacuation sim</h2>
          <div className="stat">{fr ? fr.t.toFixed(0) : 0} s<small>{out} of {res?.occupants ?? occ} out</small></div>
          <div className="bar big"><i style={{ width: `${res ? out / res.occupants * 100 : 0}%` }} /></div>
          <div className="row-btns"><input className="num" type="number" min="1" max="300" value={occ} onChange={(e) => setOcc(+e.target.value)} aria-label="Occupants" />
            <button className="btn f wide" onClick={run}><Icon name="play" />Run sim</button></div>
          {err && <p className="err">{err}</p>}
        </div>
        {res && <div className="panel"><div className="row one"><span>Clear time</span><b>{res.clear_time_s} s</b></div><div className="row one"><span>Bottleneck door</span><b>{res.bottleneck_door_id?.replace('d-', '')}</b></div>
          {Object.entries(res.per_exit || {}).map(([d, n]) => <div key={d} className="row one"><span>Exit {d.replace('d-', '')}</span><b>{n} people</b></div>)}</div>}
      </div>
    </div>
  )
}

// ---------- Ask ----------
const SUGGEST = ['Where is the closest exit to the trapped person?', 'What is on the roof?', 'Which room is the worst dead end?']
export function AskPage({ ctx, k }) {
  const [q, setQ] = useState(ctx.params.q || ''); const [log, setLog] = useState([]); const [busy, setBusy] = useState(false)
  const send = async (text) => {
    const t = (text ?? q).trim(); if (!t) return
    setBusy(true); setQ('')
    try { const a = await ask(ctx.buildingId, t, ctx.feed.record || {}); setLog((l) => [{ q: t, ...a }, ...l]) } catch (e) { setLog((l) => [{ q: t, answer: e.message, error: true }, ...l]) }
    setBusy(false)
  }
  useEffect(() => { if (ctx.params.q) send(ctx.params.q) }, []) // eslint-disable-line react-hooks/exhaustive-deps
  const hl = log[0]?.highlight || {}
  const polys = useMemo(() => hl.polylines || [], [hl])
  return (
    <div className="page split" style={{ gridTemplateColumns: '1fr 1fr' }}>
      <div className="col">
        <form className="askbar" onSubmit={(e) => { e.preventDefault(); send() }}><Icon name="ask" /><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Ask about this building" /><button className="btn f" disabled={busy}>{busy ? 'Asking…' : 'Ask'}</button></form>
        <div className="chips">{SUGGEST.map((s) => <button key={s} className="chip" onClick={() => send(s)}>{s}</button>)}</div>
        <div className="panel grow">{log.length ? log.map((a, i) => <div key={i} className={`qa ${i ? 'old' : ''}`}><div className="q">{a.q}</div><div className={`answer ${a.error ? 'err' : ''}`}>{a.answer}</div></div>)
          : <p className="empty">Answers highlight rooms and routes on the plan.</p>}</div>
      </div>
      <div className="panel flat"><PlanSvg plan={ctx.plan} k={k} selected={hl.rooms?.[0]} routes={polys} hiDoors={hl.doors || []} /></div>
    </div>
  )
}

// ---------- All tools ----------
export function AllPage({ go, pages, k }) {
  const status = { call: 'Transcript, replay or live mic', facts: 'Structured record with confidence', rescue: k.victim ? `Trapped in ${k.victimLabel}` : `Search ${k.plan_.length} rooms`,
    entry: `${k.search ? `Side ${k.search.side} search door` : 'Entry doors'}`, hazards: k.watch ? k.watch.text : 'Hazards with sources', hose: k.hose ? `${k.hose.total_ft} ft to the fire` : 'Hose lengths',
    exterior: 'Roof, ladders, caveats', aerial: 'Photos from every side', plan: '2D and 3D', mayday: 'Wall-follow out of any room', evac: 'Occupants to exits', ask: 'Questions about the building' }
  const groups = [...new Set(pages.map((p) => p.group))]
  return (
    <div className="page"><div className="gantry">
      {groups.map((g) => (
        <div key={g} className="group"><h2>{g}</h2>
          {pages.filter((p) => p.group === g).map((p) => (
            <button key={p.id} className={`dest ${p.alert ? 'alert' : ''}`} onClick={() => go(p.id)}>
              <div className="top"><span className="plate"><Icon name={p.id} /></span><Icon name="arrow" /></div>
              <div><b>{p.name}</b><span className="s">{status[p.id]}</span></div>
            </button>
          ))}
        </div>
      ))}
    </div></div>
  )
}
