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
  { id: 'call', name: 'Call', group: 'Incident', C: CallPage },
  { id: 'facts', name: 'Dispatch facts', group: 'Incident', C: FactsPage },
  { id: 'rescue', name: 'Rescue', group: 'Response', alert: true, C: RescuePage },
  { id: 'entry', name: 'Entry', group: 'Response', C: EntryPage },
  { id: 'hose', name: 'Hose', group: 'Response', C: HosePage },
  { id: 'evac', name: 'Evacuation', group: 'Response', C: EvacPage },
  { id: 'mayday', name: 'Mayday', group: 'Response', alert: true, C: MaydayPage },
  { id: 'hazards', name: 'Hazards', group: 'Building', C: HazardsPage },
  { id: 'exterior', name: 'Exterior', group: 'Building', C: ExteriorPage },
  { id: 'aerial', name: 'Aerial photos', group: 'Building', C: AerialPage },
  { id: 'model', name: '3D model', group: 'Building', C: ModelPage },
  { id: 'plan', name: 'Floor plan', group: 'Building', C: PlanPage },
  { id: 'ask', name: 'Ask', group: 'Building', C: AskPage },
]
const NAV_GROUPS = [
  { name: 'Incident', icon: 'call' },
  { name: 'Response', icon: 'rescue' },
  { name: 'Building', icon: 'model' },
]

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

  // the plan is sized to what is left of the window under the header, whatever height the header has
  useEffect(() => {
    const el = document.querySelector('.strip'); if (!el) return undefined
    const set = () => document.documentElement.style.setProperty('--strip-h', `${el.offsetHeight}px`)
    set(); const ro = new ResizeObserver(set); ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const ctx = {
    plan, briefing, feed, building, buildingId, params: route.params, source, mode, switchSource: (s) => switchMode(s === 'live' ? 'live' : 'demo'), calls: buildingCalls, callId,
    setCallId: (id) => { live.reset(); setCallId(id) }, speed, setSpeed: (s) => { setSpeed(s); if (live.loaded) live.setRate(s) }, seek: live.loaded ? live.seek : null, startCall, stopCall: live.reset, running, listen, caps, onSaved,
  }
  const page = PAGES.find((p) => p.id === route.id)
  const name = briefing?.building?.name || building?.name || 'Loading…'
  const address = briefing?.building?.address?.replace(/, [A-Z]{2}$/, '') || building?.address || ''
  const canLive = (caps.stt && canRecord) || !!SpeechRecognition
  const callBtn = mode === 'live'
    ? (listening
      ? <LiveBar listen={listen} onEnd={() => listen.stop()} />
      : <button className="btn f" onClick={() => startLive()} disabled={!canLive} title={canLive ? 'Take a call with the microphone' : 'This browser cannot record audio'}><Icon name="mic" />{listen.utterances.length ? 'New live call' : 'Start live call'}</button>)
    : (running ? null
      : <button className="btn f" onClick={startCall} disabled={!call} title="Replay a scripted call"><Icon name="play" />{live.loaded ? 'Replay demo call' : 'Play demo call'}</button>)

  return (
    <div className="app">
      <header className="strip">
        <div className="strip-main">
          <button className="brand-lockup" onClick={() => go('home')} aria-label="Scanferno briefing">
            <Logo size={40} /><span className="bld">{name}<small>{address}</small></span>
          </button>
          {route.id !== 'home' && <span className="crumb">{page?.group || 'Tools'} › <b>{page?.name || 'All tools'}</b></span>}
          <div className="search-wrap"><AddressSearch current={building} onOpenBuilding={openBuilding} onOpenProperty={setProperty} /></div>
          <div className="ml strip-end"><ModeSwitch mode={mode} onChange={switchMode} calling={listening} />{callBtn}</div>
        </div>
        <nav className="feature-nav" aria-label="Application features">
          <button type="button" className={`nav-home ${route.id === 'home' ? 'active' : ''}`} onClick={() => go('home')} aria-current={route.id === 'home' ? 'page' : undefined}>
            <Icon name="brief" /><span>Briefing</span>
          </button>
          <div className="nav-groups">
            {NAV_GROUPS.map((group) => {
              const items = PAGES.filter((p) => p.group === group.name)
              const active = items.some((p) => p.id === route.id)
              return <details key={`${group.name}-${route.id}`} className={`nav-group ${active ? 'active' : ''}`}
                onBlur={(e) => { if (!e.currentTarget.contains(e.relatedTarget)) e.currentTarget.open = false }}
                onKeyDown={(e) => {
                  if (e.key === 'Escape') {
                    e.preventDefault()
                    e.currentTarget.open = false
                    e.currentTarget.querySelector('summary')?.focus()
                  }
                }}>
                <summary><Icon name={group.icon} /><span>{group.name}</span><i>{items.length}</i></summary>
                <div className="nav-menu" role="group" aria-label={`${group.name} features`}>
                  {items.map((item) => (
                    <button key={item.id} type="button" className={`nav-link ${item.id === route.id ? 'active' : ''} ${item.alert ? 'alert' : ''}`}
                      aria-current={item.id === route.id ? 'page' : undefined}
                      onClick={(e) => { e.currentTarget.closest('details').open = false; go(item.id) }}>
                      <Icon name={item.id} /><span>{item.name}</span>{item.alert && <i className="nav-alert" aria-label="Priority tool" />}
                    </button>
                  ))}
                </div>
              </details>
            })}
          </div>
          <button type="button" className={`nav-all ${route.id === 'all' ? 'active' : ''}`} onClick={() => go('all')} aria-current={route.id === 'all' ? 'page' : undefined}>
            <Icon name="all" /><span>All tools</span>
          </button>
        </nav>
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
          : route.id === 'home' ? <Home k={k} plan={plan} briefing={briefing} feed={feed} go={go} building={building} mode={mode} onStartLive={() => startLive()} onRestore={restoreLive} canLive={canLive} buildings={buildings} onPickBuilding={openBuilding} />
            : route.id === 'all' ? <AllPage go={go} pages={PAGES} k={k} />
              : page ? <page.C key={`${route.id}-${buildingId}-${JSON.stringify(route.params)}`} ctx={ctx} k={k} go={go} />
                : <div className="page"><p className="empty">Unknown page. <button className="lnk" onClick={() => go('home')}>Back to the briefing</button></p></div>}
      </main>

      {property && <PropertyCard property={property} onClose={() => setProperty(null)} onOpenBuilding={openBuilding} />}
    </div>
  )
}
