import { useEffect, useRef, useState } from 'react'
import AerialView from './Aerial'
import { asset } from '../api'
import PlanSvg from './PlanSvg'
import { SIDE_NAME, STEPS, hazardName, stepScript } from './model'
import { Freshness, DeadEndPict, DistScale, EnterPict, ExitBars, ExitPict, FirePict, HoseGauge, Ring, SearchChain, Section, TrappedPict, WatchPict } from './Diagrams'
import Icon from '../ui/Icon'
import LiveSide from './LiveSide'
import BuildingPicker from '../components/BuildingPicker'
import { listLiveSessions } from '../api'
import Viewer3D from '../components/Viewer3D'
import PathSim from './PathSim'
import { prepareInOrder, speak } from '../ui/speech'

// facts the caller isn't sure of say so; confident ones stay clean
const unsure = (c) => (c != null && c < 0.85 ? ` · ${Math.round(c * 100)}% sure` : '')

// What the data can and can't promise, kept at the bottom of the page so it is there without crowding the plan
function TrustSection({ k }) {
  if (!k.age) return null
  return (
    <section className="trustsec">
      <h2>Know before you trust it <span>verify on arrival</span></h2>
      <div className="card trust">
        <Freshness age={k.age} />
        <div className="tnotes">{k.caveats.map((n) => <div key={n} className="tnote">{n}</div>)}</div>
      </div>
    </section>
  )
}

// Live test, before the call: say what will happen instead of showing someone else's facts
function LiveIntro({ onStart, onRestore, buildingId, canLive, buildings, onPick }) {
  const [recent, setRecent] = useState([])
  useEffect(() => { let on = true; listLiveSessions().then((l) => on && setRecent(l.filter((x) => x.building_id === buildingId).slice(0, 3))).catch(() => {}); return () => { on = false } }, [buildingId])
  return (
    <div className="card liveintro">
      <h3>Live test <span>nothing is preloaded</span></h3>
      <p>Press start and talk: one person plays the caller, one plays the dispatcher. The dispatcher speaks first.</p>
      <ol><li>Your voices are transcribed as you speak.</li><li>The call sheet fills in address, floor, side, trapped and hazards.</li><li>The plan and the briefing update with every fact.</li></ol>
      {buildings.length > 0 && <BuildingPicker buildings={buildings} currentId={buildingId} onPick={onPick} />}
      <button className="btn f wide" onClick={onStart} disabled={!canLive}><Icon name="mic" />Start live call</button>
      {recent.length > 0 && (
        <div className="recent">
          <h4>Calls taken since the server started</h4>
          {recent.map((r) => (
            <button key={r.session_id} className="recent-row" onClick={() => onRestore(r.session_id, r.has_audio)}>
              <span>{new Date(r.started_at * 1000).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })} · {r.lines} lines{r.has_audio ? ' · recorded' : ''}</span>
              <small>{r.preview}</small>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

function KeyBand({ k, step, blank, selectedPerson, selectedEgress, peopleCount }) {
  const wayOut = step === 3 && selectedPerson
    ? selectedEgress
      ? `${selectedEgress.distance_m} m`
      : selectedPerson.located === false ? 'Location unknown' : 'No safe route'
    : `${k.exits.length} exits`
  const wayOutSub = step === 3 && selectedPerson
    ? selectedEgress
      ? `${selectedPerson.description} · side ${selectedEgress.side || '?'}`
      : selectedPerson.located === false ? 'Update location to route' : 'Route unavailable'
    : step === 3
      ? peopleCount ? 'Select a person to see their route' : 'No person located yet'
      : `sides ${k.exitSides.join(', ')}`
  const cells = blank ? [
    { key: 'Fire', s: [], off: true, pict: <FirePict known={false} />, v: 'Listening…' },
    { key: 'Watch', s: [], off: true, pict: <WatchPict known={false} />, v: 'Listening…' },
    { key: 'Enter', s: [], off: true, pict: <EnterPict side="?" />, v: 'Listening…' },
    { key: 'Trapped', s: [], off: true, pict: <TrappedPict known={false} />, v: 'Listening…' },
    { key: 'Way out', s: [], off: true, pict: <ExitPict />, v: 'Listening…' },
  ] : [
    { key: 'Fire', s: [0], hot: k.fireKnown, off: !k.fireKnown, pict: <FirePict stories={k.stories} floor={k.floor} side={k.side} known={k.fireKnown} />,
      v: k.fireKnown ? (k.floor ? `Floor ${k.floor}` : 'Reported') : 'Listening…', sub: k.fireKnown && k.side ? `Side ${k.side} · ${SIDE_NAME[k.side]}${unsure(k.conf.side)}` : null },
    { key: 'Watch', s: [1], off: !k.watch, pict: <WatchPict known={!!k.watch} o2={k.isO2} />,
      v: k.watch ? hazardName(k.watch) : 'Listening…', sub: k.watch ? `from ${k.watch.source}${k.watch.source === 'dispatch' ? unsure(k.conf.hazards) : ''}` : null },
    { key: 'Enter', s: [1], pict: <EnterPict side={k.search?.side} />, v: k.search ? `Side ${k.search.side} door` : 'No door found', sub: k.searchRoom ? `into ${k.searchRoom}` : null },
    { key: 'Trapped', s: [2], hot: !!k.victim, off: !k.victim, pict: <TrappedPict known={!!k.victim} />, v: k.victimLabel || 'Listening…', sub: k.victim && k.victimConf != null ? `${Math.round(k.victimConf * 100)}% sure` : null },
    { key: 'Way out', s: [3], pict: <ExitPict />, v: step === 3 ? wayOut : k.vRoute ? `${k.vRoute.distance_m} m` : `${k.exits.length} exits`,
      sub: step === 3 ? wayOutSub : k.vRoute ? `from victim · side ${k.vExitSide || '?'}` : `sides ${k.exitSides.join(', ')}` },
  ]
  return (
    <div className="keyband">
      {cells.map((c) => (
        <div key={`${c.key}-${c.v}`} className={`kcell ${c.s.includes(step) ? 'now' : ''} ${c.hot ? 'hot' : ''} ${c.off ? 'off' : ''}`}>
          {c.pict}<div><span>{c.key}</span><b>{c.v}</b>{c.sub && <em>{c.sub}</em>}</div>
        </div>
      ))}
    </div>
  )
}

function rescueRoster(k) {
  const people = [...(k.rescuePeople || [])]
  const descriptions = new Set(people.map((p) => (p.description || '').trim().toLowerCase()).filter(Boolean))
  for (const [i, person] of (k.trapped || []).entries()) {
    const description = (person.description || '').trim().toLowerCase()
    if (description && descriptions.has(description)) continue
    if (description) descriptions.add(description)
    people.push({ ...person, id: person.id || `trapped-${i}` })
  }
  return people.map((person, i) => {
    const position = person.position || k.R[person.room_id]?.centroid || null
    return {
      ...person,
      id: person.id || `person-${i}`,
      position,
      located: person.located ?? !!position,
    }
  })
}

function attackPlan(k, step, selectedPerson, selectedEgress) {
  // overlays drawn on the plan for each step
  const o = { sides: step !== 0, tags: [], routes: [], dim: false, order: null, pulse: null, dashed: null, hose: null, bigExits: false, deadEnd: null, egress: null }
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
      o.tags.push({ at: k.R[k.victim].centroid, dy: -58, text: `TRAPPED · ${k.victimLabel.toUpperCase()}`, cls: 'r' })
      o.tags.push({ at: exitPt(k.vRoute), dy: 44, text: `ENTER · ${k.vRoute.distance_m} M TO VICTIM`, cls: 'f' })
    } else if (!k.victim) o.order = Object.fromEntries(k.plan_.slice(0, 5).map((s, i) => [s.room_id, i + 1]))
  }
  if (step === 3) {
    o.deadEnd = selectedPerson?.room_id === k.deadEnd ? k.deadEnd : null
    o.egress = selectedEgress
    if (selectedEgress?.polyline) o.routes = [selectedEgress.polyline]
  }
  if (step > 0 && k.fireKnown && k.fireIds[0]) o.tags.push({ at: k.R[k.fireIds[0]].centroid, dx: 60, dy: k.victim && k.fireIds.includes(k.victim) ? 70 : -62, text: k.isO2 ? 'FIRE · O₂ CYLINDERS REPORTED' : 'FIRE AREA', cls: 'r' })
  return o
}

function liveOverlay(k) {
  // during a call: everything known so far at once, so each new fact visibly lands on the plan
  const o = { sides: true, tags: [], routes: [], order: Object.fromEntries(k.plan_.slice(0, 4).map((s, i) => [s.room_id, i + 1])), pulse: null, dashed: null }
  if (k.victim && k.vRoute) {
    o.dashed = [...k.vRoute.polyline].reverse(); o.pulse = k.R[k.victim].centroid
    o.tags.push({ at: k.R[k.victim].centroid, dy: -58, text: `TRAPPED · ${k.victimLabel.toUpperCase()}`, cls: 'r' })
  }
  if (k.fireKnown && k.fireIds[0]) o.tags.push({ at: k.R[k.fireIds[0]].centroid, dx: 60, dy: k.victim && k.fireIds.includes(k.victim) ? 70 : -62, text: k.isO2 ? 'FIRE · O₂ CYLINDERS REPORTED' : 'FIRE AREA', cls: 'r' })
  return o
}

function StepPanel({ k, step, briefing, go, people, selectedPerson, selectedEgress, onSelectPerson }) {
  if (step === 0) {
    const img = briefing.images?.[k.frontView]
    return (
      <>
        {img && <div className="photo aerial-photo"><AerialView view={k.frontView} src={img} k={k} compact /></div>}
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
  if (step === 3) return (
    <>
      <div className="card">
        <h3>People to evacuate <span>{people.length ? 'Select a person for their route' : 'No location reported'}</span></h3>
        {people.length ? people.map((person) => {
          const room = person.room_id && k.R[person.room_id] ? k.label(person.room_id) : null
          const status = person.located ? room || 'Location reported' : 'Location unknown'
          return (
            <button key={person.id} type="button" className={`row ${person.id === selectedPerson?.id ? 'sel' : ''}`}
              aria-pressed={person.id === selectedPerson?.id} onClick={() => onSelectPerson(person.id)}>
              <span className={`sh ${person.located ? 'r' : 'o'}`}>{person.located ? 'P' : '?'}</span>
              <div><b>{person.description || 'Person'}</b><small>{status}</small></div>
              {person.id === selectedPerson?.id && <span className="route-badge">Selected</span>}
            </button>
          )
        }) : (
          <div className="egress-empty">
            <p className="muted">No person location is in the briefing yet. Add one in Rescue or wait for a caller update.</p>
            <button type="button" className="btn egress-add" onClick={() => go('rescue')}>Add person location</button>
          </div>
        )}
      </div>
      {selectedPerson && (
        <div className={`card ${selectedEgress ? '' : 'egress-unavailable'}`}>
          <h3>{selectedEgress ? 'Selected exit route' : 'Exit route unavailable'}</h3>
          <p className="note">{selectedEgress?.text || (selectedPerson.located === false
            ? 'This person has no confirmed room yet. Update their location to calculate an exit route.'
            : 'No safe exit route is available from this location.')}</p>
        </div>
      )}
      <div className="card"><h3>Distance to the nearest exit</h3><ExitBars k={k} /></div>
      {k.deadEnd && <div className="card"><div className="hzrow"><DeadEndPict /><div><b>{k.label(k.deadEnd)} is a dead end</b><span>One way in, one way out</span></div></div></div>}
      <button className="btn red wide" onClick={() => go('mayday', { room: selectedPerson?.room_id || k.victim || k.deadEnd })}>Mayday: wall-follow directions<Icon name="arrow" /></button>
    </>
  )
  return null
}

export default function Home({ k, plan, briefing, feed, go, building, mode, onStartLive, onRestore, canLive, buildings = [], onPickBuilding }) {
  const [step, setStep] = useState(0)
  const [view, setView] = useState('2d')
  const [selectedPersonId, setSelectedPersonId] = useState(null)
  const [follow, setFollow] = useState(true)
  const [flash, setFlash] = useState(null)
  const live = ['live', 'connecting', 'paused'].includes(feed.status)
  const [narrating, setNarrating] = useState(false)
  const [sim, setSim] = useState(false) // false | 'target' | 'total'
  const [simMenu, setSimMenu] = useState(false)
  // the right-hand panel can fold away so the plan or 3D model gets the whole width; remembered per browser
  const [sideOpen, setSideOpen] = useState(() => { try { return localStorage.getItem('scanferno.sideOpen') !== '0' } catch { return true } })
  const toggleSide = () => setSideOpen((v) => { try { localStorage.setItem('scanferno.sideOpen', v ? '0' : '1') } catch { /* storage unavailable */ } return !v })
  const [reading, setReading] = useState(false)
  // live test: while the call runs the side panel is the call sheet; when it ends it switches to the briefing
  const [tab, setTab] = useState('call')
  // the recording of the live call, to hear it back
  const rec = useRef(null)
  const [hear, setHear] = useState({ playing: false, t: 0 })
  const hasRec = mode === 'live' && !!feed.recordingUrl
  const hasCall = mode === 'live' && (feed.utterances.length > 0 || live)
  // Live test before any facts have been heard: nothing from the building's preset briefing is shown or playable
  const blank = mode === 'live' && !feed.record
  const [caption, setCaption] = useState(null)
  const alive = useRef(false)

  // narration in the ElevenLabs narrator voice; `run` guards against a stopped or restarted session
  const line = useRef(null); const run = useRef(0)
  const [voiceErr, setVoiceErr] = useState(null)
  const [loadingVoice, setLoadingVoice] = useState(false)
  const halt = () => { run.current += 1; line.current?.stop(); line.current = null }
  const stop = () => { halt(); alive.current = false; setNarrating(false); setCaption(null); setLoadingVoice(false) }
  const narrate = (i, id) => {
    if (id !== run.current) return
    if (i >= STEPS.length) { stop(); return }
    setStep(i)
    const txt = stepScript(k, i, mode === 'live')
    setCaption({ txt, at: 0, end: 0 }); setLoadingVoice(true)
    const h = speak(txt, { voice: 'briefing', onStart: () => setLoadingVoice(false), onWord: (w) => setCaption({ txt, at: w.s, end: w.e }) })
    line.current = h
    h.finished.then((why) => {
      if (id !== run.current) return
      if (why === 'error') { setVoiceErr('ElevenLabs voice unavailable. Use Read instead.'); stop(); return }
      if (why === 'ended') setTimeout(() => narrate(i + 1, id), 150)
    })
  }
  const begin = (i) => {
    rec.current?.pause()
    halt(); setVoiceErr(null); setFollow(false); setSim(false); alive.current = true; setNarrating(true)
    const from = Math.max(0, Math.min(STEPS.length - 1, i))
    // the step about to play first, then the rest in order, one request at a time
    prepareInOrder([...STEPS.keys()].slice(from).concat([...STEPS.keys()].slice(0, from)).map((j) => stepScript(k, j, mode === 'live')), 'briefing')
    narrate(from, run.current)
  }
  const jump = (i) => begin(i)
  const toggle = () => { if (narrating) stop(); else begin(0) }
  const toggleRec = () => { const a = rec.current; if (!a) return; if (a.paused) { stop(); a.play().catch(() => {}) } else a.pause() }
  const seekRec = (t) => { const a = rec.current; if (!a) return; stop(); a.currentTime = t; a.play().catch(() => {}) }
  const buildingBriefing = mode === 'live' && feed.processing
  useEffect(() => () => { run.current += 1; line.current?.stop() }, [])
  // generate the voice in the background once the briefing settles, so Play starts at once.
  // Not during a live call: the text changes with every caller line and each version costs a generation.
  const scripts = STEPS.map((_, j) => stepScript(k, j, mode === 'live')).join('\n')
  useEffect(() => {
    if (blank || feed.status === 'live' || feed.status === 'connecting') return undefined
    const t = setTimeout(() => prepareInOrder(scripts.split('\n'), 'briefing'), 1200)
    return () => clearTimeout(t)
  }, [scripts, feed.status, blank])
  useEffect(() => {
    const onKey = (e) => { if (/^[1-4]$/.test(e.key) && !e.target.closest('input,textarea,select')) { stop(); setFollow(false); setSim(false); setStep(+e.key - 1) } }
    window.addEventListener('keydown', onKey); return () => window.removeEventListener('keydown', onKey)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // a call starting hands the plan to live mode; when it ends, land on the step that matters most
  const prevStatus = useRef(feed.status)
  useEffect(() => {
    const was = prevStatus.current; prevStatus.current = feed.status
    if (feed.status === 'connecting' || (feed.status === 'live' && was !== 'live')) { setFollow(true); setTab('call') }
    if (feed.status === 'done' && was === 'live') { setFollow(false); setStep(k.victim ? 2 : 0); setTab('brief') }
  }, [feed.status]) // eslint-disable-line react-hooks/exhaustive-deps
  // flash the rooms each briefing update names, with the change as a banner
  useEffect(() => {
    const ch = briefing.changes || []
    if (!ch.length || feed.jumped) return undefined
    const ids = [...new Set(ch.flatMap((c) => (c.kind === 'fire' ? k.fireIds : c.room_id ? [c.room_id] : [])))]
    const items = ch.filter((c) => c.kind !== 'search_plan' || ch.length === 1)
    setFlash({ ids, items, key: briefing.generated_at })
    const t = setTimeout(() => setFlash(null), 6000)
    return () => clearTimeout(t)
  }, [briefing.generated_at]) // eslint-disable-line react-hooks/exhaustive-deps
  const people = rescueRoster(k)
  const selectedPerson = people.find((person) => person.id === selectedPersonId)
    || people.find((person) => person.room_id === k.victim)
    || people.find((person) => person.located && person.room_id)
    || people[0]
    || null
  const selectedEgress = selectedPerson?.located !== false && selectedPerson?.room_id
    ? selectedPerson.extraction || selectedPerson.recommended_route?.extraction || k.routeOf(selectedPerson.room_id)
    : null
  // switching to a blank slate stops any narration and closes the text and simulation views
  useEffect(() => { if (blank) { stop(); setSim(false); setReading(false); setStep(0) } }, [blank]) // eslint-disable-line react-hooks/exhaustive-deps
  const livePlan = live && follow
  const overlay = livePlan ? liveOverlay(k) : attackPlan(k, step, selectedPerson, selectedEgress)
  if (livePlan && step === 3) {
    overlay.dashed = null
    overlay.egress = selectedEgress
    overlay.routes = selectedEgress?.polyline ? [selectedEgress.polyline] : []
  }
  const o = blank ? { sides: false, tags: [], routes: [], order: null, doors: false, flash: [] } : { ...overlay, flash: flash?.ids || [] }
  const victimName = k.rescuePeople.find((p) => p.room_id === k.victim)?.description
    || k.trapped.find((p) => p.room_id === k.victim)?.description
    || k.victimLabel
    || 'victim'
  const stageRoute = step === 3 && o.egress
    ? { extraction: { ...o.egress, side: o.egress.side || k.doors[o.egress.exit_door_id]?.side }, person: selectedPerson }
    : step === 2 && k.vRoute && o.dashed
      ? { entry: { ...k.vRoute, polyline: o.dashed, side: k.vExitSide }, person: { description: victimName } }
      : null
  const last = feed.utterances.at(-1)
  return (
    <div className={`page brief ${sideOpen ? '' : 'noside'}`}>
      {mode === 'live' && <audio ref={rec} src={feed.recordingUrl || undefined} hidden onPlay={() => setHear((h) => ({ ...h, playing: true }))} onPause={() => setHear((h) => ({ ...h, playing: false }))} onEnded={() => setHear({ playing: false, t: 0 })} onLoadedMetadata={(e) => { const a = e.currentTarget; if (a.duration === Infinity) { /* MediaRecorder files carry no length: read to the end once so seeking works */ a.currentTime = 1e101; const fix = () => { a.removeEventListener('timeupdate', fix); a.currentTime = 0 }; a.addEventListener('timeupdate', fix) } }} onTimeUpdate={(e) => setHear({ playing: !e.currentTarget.paused, t: e.currentTarget.currentTime })} />}
      <KeyBand k={k} step={step} blank={blank} selectedPerson={selectedPerson} selectedEgress={selectedEgress} peopleCount={people.length} />
      <div className="stagerow">
      {sim ? <PathSim mode={sim} k={k} building={building} plan={plan} briefing={briefing} onClose={() => setSim(false)} /> : <>
      <div className="stage panel">
        <div className={`stagehead ${live ? 'live' : ''}`}>
          <div className="stagehead-l">
            {livePlan && <button className="livebadge" onClick={() => setFollow(false)} title="Click a step to take over"><span className="dotlive" />Live · the plan updates as the caller talks</button>}
            {live && !follow && <button className="livebadge off" onClick={() => setFollow(true)}><span className="dotlive" />Back to live</button>}
          </div>
          <div className="newbanner" key={flash?.key || 'none'}>
            {(flash?.items || []).slice(0, 2).map((c, i) => <div key={i} className={`nb ${c.kind}`} title={c.text}><b>New</b><span>{c.text}</span></div>)}
          </div>
          <div className="stage-tools">
            {!sideOpen && <button className="panel-reopen" onClick={toggleSide} aria-expanded={false} aria-controls="side-panel">Show panel</button>}
            <div className="seg stage-mode">
              <button className={view === '2d' ? 'on' : ''} onClick={() => setView('2d')}>2D plan</button>
              <button className={view === '3d' ? 'on' : ''} onClick={() => setView('3d')}>3D model</button>
            </div>
          </div>
        </div>
        <div className="planwrap">
          {view === '3d'
            ? <Viewer3D building={building} plan={plan} layers={{ order: step >= 2, routes: step >= 2, doors: true, heat: false, windows: false }}
                searchOrder={o.order || {}} trapped={briefing.trapped || []} fireRooms={briefing.fire_room_ids}
                rescuePeople={people}
                selectedPersonId={selectedPerson?.id}
                onPersonSelect={setSelectedPersonId}
                selected={step === 3 ? selectedPerson?.room_id : step === 2 ? k.victim : null} onSelect={() => {}}
                highlight={step === 1 && o.hose ? { rooms: [], polylines: [o.hose] } : null}
                selectedRoute={stageRoute}
                mayday={null} evac={null} />
            : <PlanSvg plan={plan} k={k} {...o} selected={step === 3 ? selectedPerson?.room_id : step === 2 ? k.victim : null}
                people={people.map((person) => ({ id: person.id, at: person.position, label: person.description, located: person.located }))}
                selectedPersonId={selectedPerson?.id} onPersonSelect={setSelectedPersonId} />}
        </div>
        {voiceErr && <p className="caption err">{voiceErr}</p>}
        {narrating && caption && !reading ? (
          <p className={`caption ${loadingVoice ? 'loading' : ''}`}>{loadingVoice && <span className="vload">Preparing voice… </span>}<span className="said">{caption.txt.slice(0, caption.at)}</span><mark>{caption.txt.slice(caption.at, caption.end)}</mark>{caption.txt.slice(caption.end)}</p>
        ) : live ? (
          <div className="ticker"><span className="dotlive" /><b>{last?.role || 'call'}</b>{last?.text || 'Listening…'}</div>
        ) : null}
      </div>
      <div className="side" id="side-panel" key={`${step}-${reading}-${tab}`}>
        <div className="side-head">
          <b>Briefing panel</b>
          <button className="side-collapse" onClick={toggleSide} aria-expanded={true} aria-controls="side-panel" title="Hide briefing panel">
            Hide panel <span aria-hidden="true">›</span>
          </button>
        </div>
        {hasCall && !blank && <div className="seg side-tabs"><button className={tab === 'call' ? 'on' : ''} onClick={() => setTab('call')}>Call sheet</button><button className={tab === 'brief' ? 'on' : ''} onClick={() => setTab('brief')}>Briefing</button></div>}
        {reading ? (
          <div className="readp"><h2>Briefing <span>tap a step to show it on the plan</span></h2>
            {STEPS.map((s, i) => (
              <button key={s} className={`para ${i === step ? 'on' : ''}`} onClick={() => { stop(); setStep(i) }}>
                <i>{i + 1}</i><div><b>{s}</b><p>{narrating && i === step && caption ? <><span className="said">{caption.txt.slice(0, caption.at)}</span><mark>{caption.txt.slice(caption.at, caption.end)}</mark>{caption.txt.slice(caption.end)}</> : stepScript(k, i, mode === 'live')}</p></div>
              </button>
            ))}
          </div>
        ) : blank ? (hasCall ? <LiveSide feed={feed} onSeek={hasRec ? seekRec : undefined} hearT={hasRec && hear.playing ? hear.t : null} /> : <LiveIntro onStart={onStartLive} onRestore={onRestore} buildingId={building?.id} canLive={canLive} buildings={buildings} onPick={onPickBuilding} />)
          : hasCall && tab === 'call' ? <LiveSide feed={feed} onSeek={hasRec ? seekRec : undefined} hearT={hasRec && hear.playing ? hear.t : null} />
            : <StepPanel k={k} step={step} briefing={briefing} go={go} people={people} selectedPerson={selectedPerson}
              selectedEgress={selectedEgress} onSelectPerson={setSelectedPersonId} />}
      </div>
      </>}
      </div>
      {!blank && <div className="stepper">
        {STEPS.map((s, i) => (
          <button key={s} className={`stp ${!livePlan && i === step ? 'on' : ''} ${!livePlan && i < step ? 'past' : ''}`} onClick={() => { setSim(false); if (narrating) jump(i); else { stop(); setFollow(false); setStep(i) } }}><i>{i + 1}</i>{s}</button>
        ))}
        {narrating && <button className="btn play skip" onClick={() => jump(step - 1)} disabled={step === 0} aria-label="Previous step"><Icon name="prev" /></button>}
        {narrating && <button className="btn play skip" onClick={() => jump(step + 1)} disabled={step === STEPS.length - 1} aria-label="Next step"><Icon name="next" /></button>}
        {hasRec && <button className="btn play" onClick={toggleRec} title="Hear the recording of your call"><Icon name={hear.playing ? 'pause' : 'call'} />{hear.playing ? 'Pause call' : 'Hear the call'}</button>}
        <button className="btn f play" onClick={toggle} disabled={buildingBriefing && !narrating} title={mode === 'live' ? 'Read out the briefing built from your call' : undefined}>
          {buildingBriefing && !narrating ? <><span className="dotlive" />Building…</> : <><Icon name={narrating ? 'pause' : 'speak'} />{narrating ? 'Stop' : mode === 'live' ? 'Play call briefing' : 'Play'}</>}
        </button>
        <div className="simmenu" onMouseEnter={() => setSimMenu(true)} onMouseLeave={() => setSimMenu(false)} onBlur={(e) => { if (!e.currentTarget.contains(e.relatedTarget)) setSimMenu(false) }}>
          <button className={`btn play ${sim ? 'on' : ''}`} disabled={!k.plan_.length} aria-haspopup="menu" aria-expanded={simMenu}
            onClick={() => { if (sim) { setSim(false); setSimMenu(false) } else setSimMenu((v) => !v) }} title="Animate a run through the building"><Icon name="route" />Path simulation</button>
          {simMenu && !sim && (
            <div className="simdrop" role="menu">
              <button role="menuitem" onClick={() => { stop(); setReading(false); setSim('target'); setSimMenu(false) }}><b>Path to target</b><small>In to the person to save, then out</small></button>
              <button role="menuitem" onClick={() => { stop(); setReading(false); setSim('total'); setSimMenu(false) }}><b>Total path</b><small>Every room in order, then out</small></button>
            </div>
          )}
        </div>
        <button className={`btn play ${reading ? 'on' : ''}`} onClick={() => setReading((r) => !r)}><Icon name="facts" />{reading ? 'Close text' : 'Read'}</button>
      </div>}

      {!blank && <TrustSection k={k} />}
    </div>
  )
}
