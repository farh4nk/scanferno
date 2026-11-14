import { useEffect, useMemo, useState } from 'react'
import { getBuildings, getCalls, getFloorplan, getBriefing } from './api'
import { useLiveCall } from './useLiveCall'
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

export default function App() {
  const [buildings, setBuildings] = useState([])
  const [calls, setCalls] = useState([])
  const [buildingId, setBuildingId] = useState('costar-239873')
  const [callId, setCallId] = useState('')
  const [plan, setPlan] = useState(null)
  const [baseBriefing, setBaseBriefing] = useState(null)
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

  useEffect(() => {
    Promise.all([getBuildings(), getCalls()])
      .then(([b, c]) => { setBuildings(b); setCalls(c) })
      .catch((e) => setError(`Cannot reach the backend (${e.message}). Start it with: cd backend && .venv/bin/uvicorn app.main:app --reload`))
  }, [])

  const buildingCalls = useMemo(() => calls.filter((c) => c.building_id === buildingId), [calls, buildingId])

  useEffect(() => {
    live.reset(); setSelected(null); setHighlight(null); setMayday(null); setEvacFrame(null); setEvac(null)
    setPlan(null); setBaseBriefing(null)
    getFloorplan(buildingId).then(setPlan).catch((e) => setError(e.message))
    getBriefing(buildingId).then(setBaseBriefing).catch((e) => setError(e.message))
    // eslint-disable-next-line
  }, [buildingId])

  useEffect(() => { setCallId(buildingCalls[0]?.call_id || '') }, [buildingCalls])

  const briefing = live.briefing || baseBriefing
  const call = calls.find((c) => c.call_id === callId)
  // the mayday overlay can come from the live call stream or from the manual panel
  const activeMayday = mayday || live.mayday

  const searchOrder = useMemo(
    () => Object.fromEntries((briefing?.search_plan || []).map((s, i) => [s.room_id, i + 1])),
    [briefing],
  )

  const focusRoom = (id) => { setSelected(id); setHighlight(null) }
  const running = live.status === 'connecting' || live.status === 'live'

  return (
    <div className="app">
      <header>
        <div className="brand"><span className="flame">🔥</span> SCANFERNO <span className="muted small">pre-entry briefing</span></div>
        <div className="controls">
          <select value={buildingId} onChange={(e) => setBuildingId(e.target.value)}>
            {buildings.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select>
          <select value={callId} onChange={(e) => { live.reset(); setCallId(e.target.value) }}>
            {buildingCalls.map((c) => <option key={c.call_id} value={c.call_id}>{c.title.replace(/^[^:]+: /, '')}{c.has_audio ? '' : ' (no audio)'}</option>)}
          </select>
          <select value={speed} onChange={(e) => setSpeed(+e.target.value)} title="Replay speed">
            {[1, 2, 4].map((s) => <option key={s} value={s}>{s}×</option>)}
          </select>
          {running
            ? <button onClick={live.reset}>■ Stop</button>
            : <button className="primary" disabled={!call} onClick={() => { setMayday(null); live.start(call, speed) }}>▶ Start call</button>}
          <span className={`status ${live.status}`}>{live.status}</span>
        </div>
      </header>

      {(error || live.error) && <div className="banner">{error || live.error}</div>}

      <main>
        <section className="col left">
          <Transcript utterances={live.utterances} status={live.status} />
          <DispatchPanel record={live.record} n={live.recordN} />
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
              ? <Viewer3D building={buildings.find((b) => b.id === buildingId)} plan={plan} layers={layers}
                  searchOrder={searchOrder} trapped={briefing?.trapped || []} fireRooms={briefing?.fire_room_ids}
                  selected={selected} onSelect={focusRoom} highlight={highlight} mayday={activeMayday} evac={evac} />
              : plan
                ? <FloorPlan plan={plan} layers={layers} searchOrder={searchOrder}
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
            <MaydayPanel buildingId={buildingId} rooms={plan?.rooms || []} liveMayday={live.mayday} onResult={setMayday} />
            <EvacPanel buildingId={buildingId} onFrame={setEvacFrame} onResult={setEvac} />
          </div>
        </section>

        <section className="col right">
          <BriefingPanel b={briefing} onFocusRoom={focusRoom} />
          <AerialPanel images={briefing?.images} building={briefing?.building} roof={briefing?.roof?.material} />
          <AskPanel buildingId={buildingId} dispatch={live.record} onHighlight={setHighlight} />
        </section>
      </main>
    </div>
  )
}
