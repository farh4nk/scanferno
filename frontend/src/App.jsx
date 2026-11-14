import { useCallback, useEffect, useMemo, useState } from 'react'
import { getBuildings, getCalls, health } from './api'
import { useLiveCall } from './hooks/useLiveCall'
import { useListen } from './hooks/useListen'
import { useBuildingData } from './hooks/useBuildingData'
import { deriveBrief } from './brief/model'
import Home from './brief/Home'
import AddressSearch from './components/search/AddressSearch'
import PropertyCard from './components/search/PropertyCard'
import Icon from './ui/Icon'
import {
  AerialPage, AllPage, AskPage, CallPage, EntryPage, EvacPage, ExteriorPage, FactsPage, HazardsPage, HosePage, MaydayPage, PlanPage, RescuePage,
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
  { id: 'plan', name: 'Floor plan', group: 'Inside', C: PlanPage },
  { id: 'mayday', name: 'Mayday', group: 'Inside', alert: true, C: MaydayPage },
  { id: 'evac', name: 'Evacuation', group: 'Inside', C: EvacPage },
  { id: 'ask', name: 'Ask', group: 'Anywhere', C: AskPage },
]
const TOOLS = ['call', 'plan', 'mayday', 'evac', 'aerial', 'ask']

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
  const [source, setSource] = useState('replay')
  const [buildingId, setBuildingId] = useState(initialBuilding)
  const [property, setProperty] = useState(null)
  const [callId, setCallId] = useState('')
  const [speed, setSpeed] = useState(1)
  const [error, setError] = useState(null)
  const live = useLiveCall()
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

  const openBuilding = useCallback((id) => {
    setProperty(null)
    if (!id || id === buildingId) return
    live.reset(); listen.stop(); setBuildingId(id); go('home')
  }, [buildingId, live, listen, go])

  const building = buildings.find((b) => b.id === buildingId)
  const buildingCalls = useMemo(() => calls.filter((c) => c.building_id === buildingId), [calls, buildingId])
  useEffect(() => { setCallId((id) => (buildingCalls.some((c) => c.call_id === id) ? id : buildingCalls[0]?.call_id || '')) }, [buildingCalls])

  const briefing = feed.briefing || baseBriefing
  const k = useMemo(() => deriveBrief(plan, briefing, feed.record), [plan, briefing, feed.record])
  const call = calls.find((c) => c.call_id === callId)
  const running = live.status === 'connecting' || live.status === 'live'
  const listening = listen.listening || listen.status === 'connecting'
  const startCall = () => { if (call) { if (source !== 'replay') setSource('replay'); live.start(call, speed) } }
  const switchSource = (s) => { live.reset(); listen.stop(); setSource(s) }
  const onSaved = (id) => getCalls().then((c) => { setCalls(c); setCallId(id) })

  const ctx = {
    plan, briefing, feed, building, buildingId, params: route.params, source, switchSource, calls: buildingCalls, callId,
    setCallId: (id) => { live.reset(); setCallId(id) }, speed, setSpeed, startCall, stopCall: live.reset, running, listen, caps, onSaved,
  }
  const page = PAGES.find((p) => p.id === route.id)
  const next = page && PAGES[PAGES.indexOf(page) + 1]
  const name = briefing?.building?.name || building?.name || 'Loading…'
  const address = briefing?.building?.address?.replace(/, [A-Z]{2}$/, '') || building?.address || ''
  const callBtn = running || listening
    ? <button className="btn" onClick={() => { live.reset(); listen.stop() }}><span className="dotlive" />{source === 'live' ? 'Live call' : 'Call playing'}<Icon name="stop" /></button>
    : <button className="btn" onClick={startCall} disabled={!call}><Icon name="play" />{feed.utterances.length ? 'Replay call' : 'Play call'}</button>

  return (
    <div className="app">
      <header className="strip">
        {route.id === 'home'
          ? <><div className="sf" aria-label="Scanferno">SF</div><span className="bld">{name}<small>{address}</small></span></>
          : <><button className="btn" onClick={() => go('home')}><Icon name="back" />Briefing</button>
            <span className="crumb">{page?.group || 'Tools'} › <b>{page?.name || 'All tools'}</b></span><span className="bld dim">{name}</span></>}
        {callBtn}
        <div className="search-wrap"><AddressSearch current={building} onOpenBuilding={openBuilding} onOpenProperty={setProperty} /></div>
        {route.id === 'home'
          ? <nav className="tools ml">{TOOLS.map((t) => <button key={t} onClick={() => go(t)}>{PAGES.find((p) => p.id === t).name.replace('Aerial photos', 'Photos').replace('Floor plan', 'Plan')}</button>)}<button onClick={() => go('all')}>All</button></nav>
          : next && <button className="btn f ml" onClick={() => go(next.id)}>Next: {next.name}<Icon name="arrow" /></button>}
      </header>

      {(error || dataError || feed.error) && <div className="banner" role="alert">{error || dataError || feed.error}</div>}

      <main className="main">
        {!k ? <div className="page"><p className="empty">{error ? 'Waiting for the backend…' : 'Loading the building…'}</p></div>
          : route.id === 'home' ? <Home k={k} plan={plan} briefing={briefing} feed={feed} go={go} />
            : route.id === 'all' ? <AllPage go={go} pages={PAGES} k={k} />
              : page ? <page.C key={`${route.id}-${buildingId}-${JSON.stringify(route.params)}`} ctx={ctx} k={k} go={go} />
                : <div className="page"><p className="empty">Unknown page. <button className="lnk" onClick={() => go('home')}>Back to the briefing</button></p></div>}
      </main>

      {property && <PropertyCard property={property} onClose={() => setProperty(null)} onOpenBuilding={openBuilding} />}
    </div>
  )
}
