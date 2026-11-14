import { useEffect, useRef, useState } from 'react'
import { asset } from '../api'
import PlanSvg from './PlanSvg'
import { SIDE_NAME, STEPS, hazardName, stepScript } from './model'
import { DeadEndPict, DistScale, EnterPict, ExitBars, ExitPict, FirePict, HoseGauge, Ring, SearchChain, Section, TrappedPict, WatchPict } from './Diagrams'
import Icon from '../ui/Icon'

function KeyBand({ k, step }) {
  const cells = [
    { key: 'Fire', s: [0], hot: k.fireKnown, off: !k.fireKnown, pict: <FirePict stories={k.stories} floor={k.floor} side={k.side} known={k.fireKnown} />,
      v: k.fireKnown ? (k.floor ? `Floor ${k.floor}` : 'Reported') : 'Listening…', sub: k.fireKnown && k.side ? `Side ${k.side} · ${SIDE_NAME[k.side]}` : null },
    { key: 'Watch', s: [1], off: !k.watch, pict: <WatchPict known={!!k.watch} o2={k.isO2} />,
      v: k.watch ? hazardName(k.watch) : 'Listening…', sub: k.watch ? `from ${k.watch.source}` : null },
    { key: 'Enter', s: [1], pict: <EnterPict side={k.search?.side} />, v: k.search ? `Side ${k.search.side} door` : 'No door found', sub: k.searchRoom ? `into ${k.searchRoom}` : null },
    { key: 'Trapped', s: [2], hot: !!k.victim, off: !k.victim, pict: <TrappedPict known={!!k.victim} />, v: k.victimLabel || 'Listening…', sub: k.victim && k.victimConf != null ? `${Math.round(k.victimConf * 100)}% sure` : null },
    { key: 'Way out', s: [3], pict: <ExitPict />, v: k.vRoute ? `${k.vRoute.distance_m} m` : `${k.exits.length} exits`, sub: k.vRoute ? `from victim · side ${k.vExitSide || '?'}` : `sides ${k.exitSides.join(', ')}` },
  ]
  return (
    <div className="keyband">
      {cells.map((c) => (
        <div key={c.key} className={`kcell ${c.s.includes(step) ? 'now' : ''} ${c.hot ? 'hot' : ''} ${c.off ? 'off' : ''}`}>
          {c.pict}<div><span>{c.key}</span><b>{c.v}</b>{c.sub && <em>{c.sub}</em>}</div>
        </div>
      ))}
    </div>
  )
}

function attackPlan(k, step) {
  // overlays drawn on the plan for each step
  const o = { sides: step !== 0, tags: [], routes: [], dim: false, order: null, pulse: null, dashed: null, hose: null, bigExits: false, deadEnd: null }
  const exitPt = (r) => r?.polyline?.at(-1)
  if (step === 0) {
    o.dim = true
    o.tags.push({ at: 'top', text: `C · REAR${k.fireKnown && k.side === 'C' ? ' · FIRE SIDE' : ''}`, cls: k.fireKnown && k.side === 'C' ? 'r' : '' })
    o.tags.push({ at: 'bottom', text: 'A · FRONT', cls: 'f' })
  }
  if (step === 1) {
    const fr = k.hose && k.routeOf(k.hose.to_room_id)
    if (fr) { o.hose = [...fr.polyline].reverse(); o.tags.push({ at: exitPt(fr), dy: 84, text: `ATTACK LINE · ${k.hose.total_ft} FT` }) }
    const sd = k.doors[k.search?.door_id]
    if (sd) o.tags.push({ at: sd.position, dy: 44, text: 'SEARCH · ENTER HERE', cls: 'f' })
  }
  if (step === 2) {
    o.order = Object.fromEntries(k.plan_.slice(1, 5).map((s, i) => [s.room_id, i + 2]))
    if (k.victim && k.vRoute) {
      o.dashed = [...k.vRoute.polyline].reverse(); o.pulse = k.R[k.victim].centroid
      o.tags.push({ at: k.R[k.victim].centroid, dy: -44, text: `TRAPPED · ${k.victimLabel.toUpperCase()}`, cls: 'r' })
      o.tags.push({ at: exitPt(k.vRoute), dy: 44, text: `ENTER · ${k.vRoute.distance_m} M TO VICTIM`, cls: 'f' })
    } else if (!k.victim) o.order = Object.fromEntries(k.plan_.slice(0, 5).map((s, i) => [s.room_id, i + 1]))
  }
  if (step === 3) {
    o.bigExits = true; o.deadEnd = k.deadEnd
    o.routes = k.plan_.slice(0, 6).map((s) => k.routeOf(s.room_id)?.polyline).filter(Boolean)
    if (k.deadEnd) o.tags.push({ at: k.R[k.deadEnd].centroid, text: 'DEAD END · NO WINDOW', cls: 'warn' })
    if (k.vRoute) o.tags.push({ at: exitPt(k.vRoute), dy: 44, text: `NEAREST EXIT · ${k.vRoute.distance_m} M`, cls: 'f' })
  }
  if (step > 0 && k.fireKnown && k.fireIds[0]) o.tags.push({ at: k.R[k.fireIds[0]].centroid, dx: 60, dy: -62, text: k.isO2 ? 'FIRE · O₂ CYLINDERS REPORTED' : 'FIRE AREA', cls: 'r' })
  return o
}

function StepPanel({ k, step, briefing, go }) {
  if (step === 0) {
    const img = briefing.images?.[k.frontView]
    return (
      <>
        {img && <div className="photo"><img src={asset(img)} alt="Side A as you pull up" />
          <span className="sl a">A</span><span className="sl b">B</span><span className={`sl c ${k.fireKnown && k.side === 'C' ? 'hot' : ''}`}>C{k.fireKnown && k.side === 'C' ? ' · FIRE' : ''}</span><span className="sl d">D</span></div>}
        <div className="card"><Section k={k} /></div>
      </>
    )
  }
  if (step === 1) return (
    <>
      {k.search && <div className="card"><h3>Search crew <span>Side {k.search.side} door into {k.searchRoom}</span></h3>
        {k.distToVictim ? <DistScale m={k.distToVictim} label="to the trapped person" /> : <p className="muted">No one reported trapped yet.</p>}</div>}
      {k.hose && <div className="card"><h3>Attack line <span>Side {k.hose.side} door</span></h3><HoseGauge ft={k.hose.total_ft} /></div>}
      <div className="card"><h3>Watch</h3><div className="hzrow"><WatchPict known={!!k.watch} o2={k.isO2} /><div><b>{k.watch ? k.watch.text.replace(/\.$/, '') : 'Nothing reported yet'}</b><span>{k.watch?.source}</span></div></div></div>
    </>
  )
  if (step === 2) return k.victim ? (
    <>
      <div className="sign r"><div className="trow">{k.victimConf != null && <Ring p={k.victimConf} />}<div><small>Trapped · from the caller</small><div className="big">{k.victimLabel}</div>{k.victimWords && <div className="sub">“{k.victimWords}”</div>}</div></div></div>
      {k.distToVictim ? <div className="card"><DistScale m={k.distToVictim} label="door to victim" /></div> : null}
      <div className="card"><h3>Then search</h3><SearchChain k={k} from={1} n={5} onRoom={(id) => go('rescue', { room: id })} /></div>
    </>
  ) : (
    <>
      <div className="sign"><div><small>Trapped</small><div className="big">Not reported yet</div><div className="sub">Listening to the caller…</div></div></div>
      <div className="card"><h3>Search order</h3><SearchChain k={k} from={0} n={5} onRoom={(id) => go('rescue', { room: id })} /></div>
    </>
  )
  return (
    <>
      <div className="card"><h3>Distance to the nearest exit</h3><ExitBars k={k} /></div>
      {k.deadEnd && <div className="card"><div className="hzrow"><DeadEndPict /><div><b>{k.label(k.deadEnd)} is a dead end</b><span>One way in, one way out</span></div></div></div>}
      <button className="btn red wide" onClick={() => go('mayday', { room: k.victim || k.deadEnd })}>Mayday: wall-follow directions<Icon name="arrow" /></button>
    </>
  )
}

export default function Home({ k, plan, briefing, feed, go }) {
  const [step, setStep] = useState(0)
  const [narrating, setNarrating] = useState(false)
  const [reading, setReading] = useState(false)
  const [caption, setCaption] = useState(null)
  const alive = useRef(false)

  const stop = () => { alive.current = false; window.speechSynthesis?.cancel(); setNarrating(false); setCaption(null) }
  const narrate = (i) => {
    if (!alive.current || i >= STEPS.length) { stop(); return }
    setStep(i)
    const txt = stepScript(k, i); const u = new SpeechSynthesisUtterance(txt); u.rate = 1.05
    setCaption({ txt, at: 0, end: 0 })
    u.onboundary = (ev) => { const b = txt.indexOf(' ', ev.charIndex + 1); setCaption({ txt, at: ev.charIndex, end: b < 0 ? txt.length : b }) }
    u.onend = () => setTimeout(() => narrate(i + 1), 350)
    window.speechSynthesis.speak(u)
  }
  const toggle = () => { if (narrating) stop(); else { window.speechSynthesis?.cancel(); alive.current = true; setNarrating(true); narrate(0) } }
  useEffect(() => () => { alive.current = false; window.speechSynthesis?.cancel() }, [])
  useEffect(() => {
    const onKey = (e) => { if (/^[1-4]$/.test(e.key) && !e.target.closest('input,textarea,select')) { stop(); setStep(+e.key - 1) } }
    window.addEventListener('keydown', onKey); return () => window.removeEventListener('keydown', onKey)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const o = attackPlan(k, step)
  const last = feed.utterances.at(-1)
  return (
    <div className="page brief">
      <KeyBand k={k} step={step} />
      <div className="stage panel">
        <div className="planwrap"><PlanSvg plan={plan} k={k} {...o} /></div>
        {narrating && caption ? (
          <p className="caption"><span className="said">{caption.txt.slice(0, caption.at)}</span><mark>{caption.txt.slice(caption.at, caption.end)}</mark>{caption.txt.slice(caption.end)}</p>
        ) : feed.status === 'live' || feed.status === 'connecting' ? (
          <div className="ticker"><span className="dotlive" /><b>{last?.role || 'call'}</b>{last?.text || 'Connecting…'}</div>
        ) : null}
      </div>
      <div className="side" key={`${step}-${reading}`}>
        {reading ? (
          <div className="readp"><h2>Briefing <span>tap a step to show it on the plan</span></h2>
            {STEPS.map((s, i) => (
              <button key={s} className={`para ${i === step ? 'on' : ''}`} onClick={() => { stop(); setStep(i) }}>
                <i>{i + 1}</i><div><b>{s}</b><p>{stepScript(k, i)}</p></div>
              </button>
            ))}
          </div>
        ) : <StepPanel k={k} step={step} briefing={briefing} go={go} />}
      </div>
      <div className="stepper">
        {STEPS.map((s, i) => (
          <button key={s} className={`stp ${i === step ? 'on' : ''} ${i < step ? 'past' : ''}`} onClick={() => { stop(); setStep(i) }}><i>{i + 1}</i>{s}</button>
        ))}
        <button className="btn f play" onClick={toggle}><Icon name={narrating ? 'pause' : 'speak'} />{narrating ? 'Stop' : 'Play'}</button>
        <button className={`btn play ${reading ? 'on' : ''}`} onClick={() => setReading((r) => !r)}><Icon name="facts" />{reading ? 'Close text' : 'Read'}</button>
      </div>
    </div>
  )
}
