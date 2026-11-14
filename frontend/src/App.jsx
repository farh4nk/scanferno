import { useCallback, useEffect, useMemo, useState } from 'react'
import { getBuildings, getCalls, health } from './api'
import { useLiveCall } from './hooks/useLiveCall'
import { useListen } from './hooks/useListen'
import { useBuildingData } from './hooks/useBuildingData'
import LivePanel from './components/LivePanel'
import AddressSearch from './components/search/AddressSearch'
import PropertyCard from './components/search/PropertyCard'
import FloorPlan from './components/FloorPlan'
import Transcript from './components/Transcript'
import DispatchPanel from './components/DispatchPanel'
import BriefingPanel from './components/BriefingPanel'
import AerialPanel from './components/AerialPanel'
import AskPanel from './components/AskPanel'
import MaydayPanel from './components/MaydayPanel'
import EvacPanel from './components/EvacPanel'
import Viewer3D from './components/Viewer3D'

const LAYERS = [['heat', 'Maze heat'], ['order', 'Search order'], ['routes', 'Exit routes'], ['doors', 'Doors'], ['windows', 'Windows']]
const DEFAULT_BUILDING = 'costar-239873'
const initialBuilding = () => new URLSearchParams(window.location.search).get('building') || DEFAULT_BUILDING

export default function App() {
  const [buildings, setBuildings] = useState([])
  const [calls, setCalls] = useState([])
  const [caps, setCaps] = useState({ llm: null, stt: false })
  const [source, setSource] = useState('replay') // replay a scripted call, or a live call (mic / typed)
  const [buildingId, setBuildingId] = useState(initialBuilding)
  const [property, setProperty] = useState(null)
  const [callId, setCallId] = useState('')
  const [layers, setLayers] = useState({ heat: true, order: true, routes: true, doors: true, windows: false })
  const [selected, setSelected] = useState(null)
  const [highlight, setHighlight] = useState(null)
  const [mayday, setMayday] = useState(null)
  const [evacFrame, setEvacFrame] = useState(null)
  const [evac, setEvac] = useState(null)
  const [mode, setMode] = useState('2d')
  const [speed, setSpeed] = useState(1)
  const [error, setError] = useState(null)
  const live = useLiveCall()
  const listen = useListen(buildingId)
  const feed = source === 'live' ? listen : live // both hooks expose utterances, record, briefing, mayday, status
  const { plan, briefing: baseBriefing, error: dataError } = useBuildingData(buildingId)

  useEffect(() => {
    Promise.all([getBuildings(), getCalls()])
      .then(([b, c]) => { setBuildings(b); setCalls(c) })
      .catch((e) => setError(`Cannot reach the backend (${e.message}). Start it with: cd backend && .venv/bin/uvicorn app.main:app --reload`))
    health().then((h) => setCaps({ llm: h.llm, stt: !!h.stt })).catch(() => {})
  }, [])

  const switchSource = (s) => { live.reset(); listen.stop(); setMayday(null); setSource(s) }
  const onSaved = (id) => getCalls().then((c) => { setCalls(c); setCallId(id) })

  // keep the open building in the URL so a refresh or a shared link lands on it
  useEffect(() => {
    const url = new URL(window.location.href)
    url.searchParams.set('building', buildingId)
    window.history.replaceState(null, '', url)
  }, [buildingId])

  const openBuilding = useCallback((id) => {
    setProperty(null)
    if (!id || id === buildingId) return
    live.reset(); setSelected(null); setHighlight(null); setMayday(null); setEvacFrame(null); setEvac(null)
    setBuildingId(id)
  }, [buildingId, live])

  const building = buildings.find((b) => b.id === buildingId)
  const buildingCalls = useMemo(() => calls.filter((c) => c.building_id === buildingId), [calls, buildingId])
  useEffect(() => {
    setCallId((id) => (buildingCalls.some((c) => c.call_id === id) ? id : buildingCalls[0]?.call_id || ''))
  }, [buildingCalls])

  const briefing = feed.briefing || baseBriefing
  const call = calls.find((c) => c.call_id === callId)
  // the mayday overlay can come from the call (replayed or live) or from the manual panel
  const activeMayday = mayday || feed.mayday

  const searchOrder = useMemo(
    () => Object.fromEntries((briefing?.search_plan || []).map((s, i) => [s.room_id, i + 1])),
    [briefing],
  )
  const routes = useMemo(
    () => Object.fromEntries((briefing?.exit_routes || []).map((r) => [r.from_room_id, r])),
    [briefing],
  )

  const focusRoom = (id) => { setSelected(id); setHighlight(null) }
  const running = live.status === 'connecting' || live.status === 'live'

  return (
    <div className="app">
      <header>
        <div className="brand"><span className="flame">🔥</span> SCANFERNO <span className="muted small">pre-entry briefing</span></div>
        <AddressSearch current={building} onOpenBuilding={openBuilding} onOpenProperty={setProperty} />
        <div className="controls">
          <span className="seg">
            <button className={source === 'replay' ? 'on' : ''} onClick={() => switchSource('replay')}>Replay</button>
            <button className={source === 'live' ? 'on' : ''} onClick={() => switchSource('live')}>Live</button>
          </span>
          {source === 'replay' && (
            <>
              <select value={callId} onChange={(e) => { live.reset(); setCallId(e.target.value) }} disabled={!buildingCalls.length}>
                {!buildingCalls.length && <option value="">No scripted calls</option>}
                {buildingCalls.map((c) => <option key={c.call_id} value={c.call_id}>{c.title.replace(/^[^:]+: /, '')}{c.has_audio ? '' : ' (no audio)'}</option>)}
              </select>
              <select value={speed} onChange={(e) => setSpeed(+e.target.value)} title="Replay speed">
                {[1, 2, 4].map((s) => <option key={s} value={s}>{s}×</option>)}
              </select>
              {running
                ? <button onClick={live.reset}>■ Stop</button>
                : <button className="primary" disabled={!call} onClick={() => { setMayday(null); live.start(call, speed) }}>▶ Start call</button>}
            </>
          )}
          <span className={`status ${feed.status}`}>{feed.status}</span>
          {caps.llm != null && <span className={`status ${caps.llm ? 'live' : ''}`} title="Gemini for extraction and summaries; offline rules otherwise">{caps.llm ? 'LLM on' : 'offline rules'}</span>}
        </div>
      </header>

      {(error || dataError || live.error) && <div className="banner">{error || dataError || live.error}</div>}

      <main>
        <section className="col left">
          {source === 'live' && <LivePanel listen={listen} stt={caps.stt} onSaved={onSaved} />}
          <Transcript utterances={feed.utterances} status={feed.status} interim={feed.interim}
            emptyText={source === 'live' ? 'Press “Listen”, upload a recording, or type a line.' : undefined} />
          <DispatchPanel record={feed.record} n={feed.recordN} />
        </section>

        <section className="col center">
          <div className="card planCard">
            <div className="plan-head">
              <h3>
                <span className="seg">
                  <button className={mode === '2d' ? 'on' : ''} onClick={() => setMode('2d')}>2D plan</button>
                  <button className={mode === '3d' ? 'on' : ''} onClick={() => setMode('3d')}>3D model</button>
                </span>
                {briefing?.building?.name || ''}
              </h3>
              <div className="layers">
                {LAYERS.map(([k, l]) => (
                  <label key={k}><input type="checkbox" checked={layers[k]} onChange={(e) => setLayers({ ...layers, [k]: e.target.checked })} />{l}</label>
                ))}
              </div>
            </div>
            {plan && mode === '3d'
              ? <Viewer3D building={building} plan={plan} layers={layers}
                  searchOrder={searchOrder} trapped={briefing?.trapped || []} fireRooms={briefing?.fire_room_ids}
                  selected={selected} onSelect={focusRoom} highlight={highlight} mayday={activeMayday} evac={evac} />
              : plan
                ? <FloorPlan plan={plan} layers={layers} searchOrder={searchOrder} routes={routes}
                    trapped={briefing?.trapped || []} fireRooms={briefing?.fire_room_ids}
                    selected={selected} onSelect={focusRoom} highlight={highlight}
                    mayday={activeMayday} evacFrame={evacFrame} sides={briefing?.sides} />
                : <p className="muted pad">Loading floor plan…</p>}
            <div className="legend">
              {layers.heat && <><span>safe</span><i className="grad" /><span>disorienting</span></>}
              <span className="k"><i className="sw fire" /> fire area</span>
              <span className="k"><i className="sw trap" /> trapped</span>
              <span className="k"><i className="sw route" /> exit route</span>
              <span className="k"><i className="sw may" /> mayday path</span>
              <span className="muted">Click a room for its route and maze reasons.</span>
            </div>
          </div>
          <div className="row2">
            <MaydayPanel buildingId={buildingId} rooms={plan?.rooms || []} liveMayday={feed.mayday} onResult={setMayday} />
            <EvacPanel buildingId={buildingId} onFrame={setEvacFrame} onResult={setEvac} />
          </div>
        </section>

        <section className="col right">
          <BriefingPanel b={briefing} onFocusRoom={focusRoom} />
          <AerialPanel images={briefing?.images} building={briefing?.building} roof={briefing?.roof?.material} />
          <AskPanel buildingId={buildingId} dispatch={feed.record} onHighlight={setHighlight} />
        </section>
      </main>

      {property && <PropertyCard property={property} onClose={() => setProperty(null)} onOpenBuilding={openBuilding} />}
    </div>
  )
}
