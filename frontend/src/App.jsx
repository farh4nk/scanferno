import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { getBuildings, getCalls, health, listLiveSessions } from './api'
import { useCallPlayer } from './hooks/useCallPlayer'
import CallBar from './brief/CallBar'
import { SpeechRecognition, canRecord, useListen } from './hooks/useListen'
import LiveBar from './components/LiveBar'
import ModeSwitch from './components/ModeSwitch'
import Logo from './components/Logo'
import { useBuildingData } from './hooks/useBuildingData'
import { deriveBrief } from './brief/model'
import Home from './brief/Home'
import AddressSearch from './components/search/AddressSearch'
import PropertyCard from './components/search/PropertyCard'
import Icon from './ui/Icon'
import {
  AerialPage, AllPage, AskPage, CallPage, EntryPage, EvacPage, ExteriorPage, FactsPage, HazardsPage, HosePage, MaydayPage, ModelPage, PlanPage, RescuePage,
} from './pages/Pages'

const DEFAULT_BUILDING = 'costar-239873'
const initialBuilding = () => new URLSearchParams(window.location.search).get('building') || DEFAULT_BUILDING

export const PAGES = [
  { id: 'call', name: 'Call', group: 'The call', C: CallPage },
  { id: 'facts', name: 'Dispatch facts', group: 'The call', C: FactsPage },
  { id: 'rescue', name: 'Rescue', group: 'Before entry', alert: true, C: RescuePage },
  { id: 'entry', name: 'Entry', group: 'Before entry', C: EntryPage },
  { id: 'hazards', name: 'Hazards', group: 'Before entry', C: HazardsPage },
  { id: 'hose', name: 'Hose', group: 'Before entry', C: HosePage },
  { id: 'exterior', name: 'Exterior', group: 'Before entry', C: ExteriorPage },
  { id: 'aerial', name: 'Aerial photos', group: 'Before entry', C: AerialPage },
  { id: 'model', name: '3D model', group: 'Inside', C: ModelPage },
  { id: 'plan', name: 'Floor plan', group: 'Inside', C: PlanPage },
  { id: 'mayday', name: 'Mayday', group: 'Inside', alert: true, C: MaydayPage },
  { id: 'evac', name: 'Evacuation', group: 'Inside', C: EvacPage },
  { id: 'ask', name: 'Ask', group: 'Anywhere', C: AskPage },
]
const TOOLS = ['model', 'call', 'plan', 'mayday', 'evac', 'aerial', 'ask']

// #page?key=value routing, so the browser back button and shared links work
const readHash = () => {
  const [id, q] = window.location.hash.slice(1).split('?')
  return { id: id || 'home', params: Object.fromEntries(new URLSearchParams(q || '')) }
}
function useRoute() {
  const [r, setR] = useState(readHash)
  useEffect(() => { const on = () => setR(readHash()); window.addEventListener('hashchange', on); return () => window.removeEventListener('hashchange', on) }, [])
  const go = useCallback((id, params) => {
    const q = params ? `?${new URLSearchParams(Object.entries(params).filter(([, v]) => v != null))}` : ''
    window.location.hash = id === 'home' ? '' : `${id}${q}`
  }, [])
  return [r, go]
}

export default function App() {
  const [route, go] = useRoute()
  const [buildings, setBuildings] = useState([])
  const [calls, setCalls] = useState([])
  const [caps, setCaps] = useState({ llm: null, stt: false })
  // Demo: preset briefing + scripted calls. Live test: the briefing is built from the call you take.
  const [mode, setMode] = useState(() => { try { return localStorage.getItem('scanferno.mode') === 'live' ? 'live' : 'demo' } catch { return 'demo' } })
  const source = mode === 'live' ? 'live' : 'replay'
  const [buildingId, setBuildingId] = useState(initialBuilding)
  const [property, setProperty] = useState(null)
  const [callId, setCallId] = useState('')
  const [speed, setSpeed] = useState(1)
  const [error, setError] = useState(null)
  const live = useCallPlayer()
  const listen = useListen(buildingId)
  const feed = source === 'live' ? listen : live
  const { plan, briefing: baseBriefing, error: dataError } = useBuildingData(buildingId)

  useEffect(() => {
    Promise.all([getBuildings(), getCalls()])
      .then(([b, c]) => { setBuildings(b); setCalls(c) })
      .catch((e) => setError(`Cannot reach the backend (${e.message}). Start it with: cd backend && .venv/bin/uvicorn app.main:app --reload`))
    health().then((h) => setCaps({ llm: h.llm, stt: !!h.stt })).catch(() => {})
  }, [])

  useEffect(() => {
    const url = new URL(window.location.href); url.searchParams.set('building', buildingId)
    window.history.replaceState(null, '', url)
  }, [buildingId])

  const [addressHint, setAddressHint] = useState(null)
  const adopting = useRef(false)

  const openBuilding = useCallback((id) => {
    setProperty(null)
    setAddressHint(null)
    if (!id || id === buildingId) return
    live.reset(); listen.stop(); setBuildingId(id); go('home')
    // Ondemand open may have just registered this building — refresh so Viewer3D gets matterport_model_id.
    getBuildings().then(setBuildings).catch(() => {})
  }, [buildingId, live, listen, go])

  const adoptBuilding = useCallback(async (id, { auto = false } = {}) => {
    setProperty(null)
    if (!id || id === buildingId) { setAddressHint(null); return }
    if (source === 'live' && listen.sessionId) {
      adopting.current = true
      const r = await listen.rebind(id)
      if (!r) { adopting.current = false; return }
      setBuildingId(id)
      setAddressHint(null)
      go(auto ? 'rescue' : 'home')
      return
    }
    live.reset(); listen.stop(); setBuildingId(id); setAddressHint(null); go('home')
  }, [buildingId, source, listen, live, go])

  // Spoken address → switch building when search is confident + ready.
  useEffect(() => {
    const m = feed.building_match
    if (!m?.hit) return
    const bid = m.hit.building_id
    if (!bid || bid === buildingId) { setAddressHint(null); return }
    if (m.auto && m.hit.status === 'ready') {
      adoptBuilding(bid, { auto: true })
    } else {
      setAddressHint(m)
    }
  }, [feed.building_match, buildingId, adoptBuilding])

  // Live call named a different address → session onboarded it; follow without killing the session.
  useEffect(() => {
    if (source !== 'live' || !listen.buildingChanged || !listen.sessionBuildingId) return
    if (listen.sessionBuildingId === buildingId) return
    listen.acceptBuildingSync()
    setBuildingId(listen.sessionBuildingId)
    getBuildings().then(setBuildings).catch(() => {})
  }, [source, listen.buildingChanged, listen.sessionBuildingId, buildingId, listen])

  const building = buildings.find((b) => b.id === buildingId)
  const buildingCalls = useMemo(() => calls.filter((c) => c.building_id === buildingId), [calls, buildingId])
  useEffect(() => { setCallId((id) => (buildingCalls.some((c) => c.call_id === id) ? id : buildingCalls[0]?.call_id || '')) }, [buildingCalls])

  const briefing = feed.briefing || baseBriefing
  const k = useMemo(() => deriveBrief(plan, briefing, feed.record), [plan, briefing, feed.record])
  const call = calls.find((c) => c.call_id === callId)
  const running = ['connecting', 'live', 'paused'].includes(live.status)
  const listening = listen.listening || listen.status === 'connecting'
  // a reloaded tab picks its live call back up (transcript, briefing, recording) while the API still has it
  useEffect(() => {
    if (mode !== 'live' || listen.sessionId || listen.utterances.length) return
    let keep = null
    try { keep = sessionStorage.getItem('scanferno.liveSid') } catch { /* storage unavailable */ }
    if (!keep) return
    listLiveSessions().then((l) => { const m = l.find((x) => x.session_id === keep && x.building_id === buildingId); if (m) listen.restore(m.session_id, { hasAudio: m.has_audio }) }).catch(() => {})
  }, [mode, buildingId]) // eslint-disable-line react-hooks/exhaustive-deps
  const restoreLive = (id, hasAudio) => { live.reset(); listen.restore(id, { hasAudio }).catch(() => {}) }
  const chooseMode = (m) => { setMode(m); try { localStorage.setItem('scanferno.mode', m) } catch { /* storage unavailable */ } }
  const switchMode = (m) => { if (m === mode) return; live.reset(); listen.reset(); chooseMode(m); go('home') }
  const startLive = (input) => {
    live.reset(); listen.reset(); chooseMode('live'); go('home')
    listen.start(input || (caps.stt && canRecord ? 'server' : 'browser'), { firstRole: 'dispatcher' })
  }
  const startCall = () => { if (call) live.start(call, speed) }
  const onSaved = (id) => getCalls().then((c) => { setCalls(c); setCallId(id) })

  const ctx = {
    plan, briefing, feed, building, buildingId, params: route.params, source, mode, switchSource: (s) => switchMode(s === 'live' ? 'live' : 'demo'), calls: buildingCalls, callId,
    setCallId: (id) => { live.reset(); setCallId(id) }, speed, setSpeed: (s) => { setSpeed(s); if (live.loaded) live.setRate(s) }, seek: live.loaded ? live.seek : null, startCall, stopCall: live.reset, running, listen, caps, onSaved,
  }
  const page = PAGES.find((p) => p.id === route.id)
  const next = page && PAGES[PAGES.indexOf(page) + 1]
  const name = briefing?.building?.name || building?.name || 'Loading…'
  const address = briefing?.building?.address?.replace(/, [A-Z]{2}$/, '') || building?.address || ''
  const canLive = (caps.stt && canRecord) || !!SpeechRecognition
  const callBtn = mode === 'live'
    ? (listening
      ? <LiveBar listen={listen} onEnd={() => listen.stop()} />
      : <button className="btn f" onClick={() => startLive()} disabled={!canLive} title={canLive ? 'Take a call with the microphone' : 'This browser cannot record audio'}><Icon name="mic" />{listen.utterances.length ? 'New live call' : 'Start live call'}</button>)
    : (running ? null
      : <button className="btn f" onClick={startCall} disabled={!call} title="Replay a scripted call"><Icon name="play" />{live.loaded ? 'Replay demo call' : 'Play demo call'}</button>)

  const toolsNav = (
    <nav className="toolrow" aria-label="Tools">
      {TOOLS.map((t) => { const p = PAGES.find((x) => x.id === t); return <button key={t} onClick={() => go(t)}><Icon name={t} />{p.name.replace('Aerial photos', 'Photos').replace('Floor plan', 'Plan')}</button> })}
      <button onClick={() => go('all')}><Icon name="facts" />All tools</button>
    </nav>
  )

  return (
    <div className="app">
      <header className="strip">
        <button className="brandmark" onClick={() => go('home')} aria-label="Scanferno home" title="Scanferno"><Logo size={42} /></button>
        {route.id === 'home'
          ? <span className="bld">{name}<small>{address}</small></span>
          : <><button className="btn" onClick={() => go('home')}><Icon name="back" />Briefing</button>
            <span className="crumb">{page?.group || 'Tools'} › <b>{page?.name || 'All tools'}</b></span><span className="bld dim">{name}</span></>}
        <div className="search-wrap"><AddressSearch current={building} onOpenBuilding={openBuilding} onOpenProperty={setProperty} /></div>
        <div className="ml strip-end"><ModeSwitch mode={mode} onChange={switchMode} calling={listening} />{callBtn}
          {route.id !== 'home' && next && <button className="btn" onClick={() => go(next.id)}>Next: {next.name}<Icon name="arrow" /></button>}</div>
      </header>

      {mode === 'demo' && live.loaded && <CallBar player={live} />}

      {(error || dataError || feed.error) && (
        <div className="banner" role="alert">{error || dataError || feed.error}
          {listen.quota && SpeechRecognition && <button className="btn" onClick={() => startLive('browser')}>Use browser speech instead</button>}
        </div>
      )}
      {addressHint?.hit && (
        <div className="addr-chip" role="status">
          <span>Heard <b>{addressHint.query}</b> <span className="muted">→ {addressHint.hit.name || addressHint.hit.address}</span></span>
          {addressHint.hit.building_id
            ? <button className="btn f" onClick={() => adoptBuilding(addressHint.hit.building_id)}>Open briefing</button>
            : <button className="btn" onClick={() => setProperty({ id: addressHint.hit.id })}>View property</button>}
          <button className="chip" onClick={() => setAddressHint(null)}>Dismiss</button>
        </div>
      )}

      <main className="main">
        {!k ? <div className="page"><p className="empty">{error ? 'Waiting for the backend…' : 'Loading the building…'}</p></div>
          : route.id === 'home' ? <Home k={k} plan={plan} briefing={briefing} feed={feed} go={go} building={building} mode={mode} onStartLive={() => startLive()} onRestore={restoreLive} canLive={canLive} tools={toolsNav} />
            : route.id === 'all' ? <AllPage go={go} pages={PAGES} k={k} />
              : page ? <page.C key={`${route.id}-${buildingId}-${JSON.stringify(route.params)}`} ctx={ctx} k={k} go={go} />
                : <div className="page"><p className="empty">Unknown page. <button className="lnk" onClick={() => go('home')}>Back to the briefing</button></p></div>}
      </main>

      {property && <PropertyCard property={property} onClose={() => setProperty(null)} onOpenBuilding={openBuilding} />}
    </div>
  )
}
