// One page per job. Each page does one thing; the home briefing links here for detail.
import { useEffect, useMemo, useRef, useState } from 'react'
import { ask, asset, getEvac, getMayday, getRoute, getTour } from '../api'
import PlanSvg from '../brief/PlanSvg'
import AerialView, { sideOfCompass, viewLabel, viewOfCompass } from '../brief/Aerial'
import { Freshness, HoseGauge, Ring, Section } from '../brief/Diagrams'
import LivePanel from '../components/LivePanel'
import Viewer3D from '../components/Viewer3D'
import Icon from '../ui/Icon'
import { prepareInOrder, speak } from '../ui/speech'
import '../ui/location-controls.css'

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
export function FactsPage({ ctx, k }) {
  const r = ctx.feed.record; const c = r?.confidence || {}; const ch = new Set(r?.changed || []); const corr = r?.corrections || {}
  const [overrides, setOverrides] = useState(ctx.feed.locationOverrides || { fire_room_id: null, people: [] })
  const [target, setTarget] = useState('fire')
  const [personName, setPersonName] = useState('')
  const [personRoom, setPersonRoom] = useState(ctx.plan?.rooms?.[0]?.id || '')
  const [saving, setSaving] = useState(false)
  const live = ctx.source === 'live'
  const people = r?.trapped || []
  const rooms = [...(ctx.plan?.rooms || [])].sort((a, b) => a.label.localeCompare(b.label))

  useEffect(() => {
    setOverrides(ctx.feed.locationOverrides || { fire_room_id: null, people: [] })
  }, [ctx.feed.locationOverrides])

  const saveLocations = async (next) => {
    setOverrides(next)
    if (!live) return
    setSaving(true)
    await ctx.listen.setLocations(next)
    setSaving(false)
  }
  const chooseRoom = (roomId) => {
    if (target === 'fire') {
      saveLocations({ ...overrides, fire_room_id: roomId || null })
      return
    }
    const person = people.find((p) => p.description.toLowerCase() === target)
    if (!person || !roomId) return
    const prior = overrides.people.find((p) => p.description.toLowerCase() === target)
    const nextPeople = overrides.people.filter((p) => p.description.toLowerCase() !== target)
    nextPeople.push({ description: person.description, room_id: roomId, manual: prior?.manual || false })
    saveLocations({ ...overrides, people: nextPeople })
  }
  const selectedPerson = target === 'fire' ? null : people.find((p) => p.description.toLowerCase() === target)
  const personOverride = selectedPerson && overrides.people.find((p) => p.description.toLowerCase() === target)
  const selectedRoom = target === 'fire'
    ? overrides.fire_room_id || ''
    : personOverride?.room_id || selectedPerson?.room_id || ''
  const mapRoom = target === 'fire' ? selectedRoom || r?.fire_room_ids?.[0] || '' : selectedRoom
  const clearPersonOverride = (person) => {
    const key = person.description.toLowerCase()
    saveLocations({
      ...overrides,
      people: overrides.people.filter((p) => p.description.toLowerCase() !== key),
    })
  }
  const addManualPerson = (e) => {
    e.preventDefault()
    const description = personName.trim()
    if (!description || !personRoom || overrides.people.some((p) => p.description.toLowerCase() === description.toLowerCase())
      || people.some((p) => p.description.toLowerCase() === description.toLowerCase())) return
    const person = { description, room_id: personRoom, manual: true }
    setTarget(description.toLowerCase())
    setPersonName('')
    saveLocations({ ...overrides, people: [...overrides.people, person] })
  }
  const chooseTarget = (value) => {
    setTarget(value)
    if (value !== 'fire') {
      const person = people.find((p) => p.description.toLowerCase() === value)
      setPersonRoom(person?.room_id || rooms[0]?.id || '')
    }
  }
  const planPeople = people.filter((p) => p.room_id && k.R[p.room_id]).map((p) => ({
    id: p.description, label: p.description, at: k.R[p.room_id].centroid,
  }))

  return (
    <div className="page split" style={{ gridTemplateColumns: '1fr minmax(420px, 520px)' }}>
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
      <div className="panel col location-editor">
        <div><h2>Fire & people locations <span>{saving ? 'saving…' : live ? 'live' : 'manual input'}</span></h2>
          <p className="note">Audio locations update as the caller talks. Manual room choices take priority until you choose “Use audio.”</p>
          {!live && <button className="btn f wide" onClick={() => ctx.switchSource('live')}>Switch to live input</button>}
        </div>
        <label className="note" htmlFor="location-target">Choose what to place</label>
        <select id="location-target" className="sel" value={target} onChange={(e) => chooseTarget(e.target.value)} disabled={!live}>
          <option value="fire">Fire location</option>
          {people.map((p, i) => <option key={`${p.description}-${i}`} value={p.description.toLowerCase()}>{p.description}{p.manual ? ' · manual' : ''}</option>)}
        </select>
        <div className="location-assignment">
          <label className="note" htmlFor="location-room">{target === 'fire' ? 'Fire room' : `${selectedPerson?.description || 'Person'} room`}</label>
          <select id="location-room" className="sel" value={selectedRoom} onChange={(e) => chooseRoom(e.target.value)} disabled={!live}>
            {target === 'fire' && <option value="">Use audio / no manual location</option>}
            {!rooms.some((room) => room.id === selectedRoom) && selectedRoom && <option value={selectedRoom}>Unknown room</option>}
            {rooms.map((room) => <option key={room.id} value={room.id}>{room.label}</option>)}
          </select>
          {target === 'fire' ? (
            <p className="small muted">{overrides.fire_room_id
              ? 'Manual location · overrides audio'
              : `From audio: ${(r?.fire_room_ids || []).map((id) => k.label(id)).join(', ') || r?.fire_location || 'not located yet'}`}</p>
          ) : selectedPerson && (
            <div className="location-source">
              <span className="small muted">{personOverride ? 'Manual location · overrides audio' : `From audio: ${selectedPerson.room_id ? k.label(selectedPerson.room_id) : 'not located yet'}`}</span>
              {personOverride && <button className="lnk" type="button" onClick={() => clearPersonOverride(selectedPerson)} disabled={!live}>
                {personOverride.manual ? 'Remove person' : 'Use audio'}
              </button>}
            </div>
          )}
        </div>
        <div className="location-map">
          <PlanSvg plan={ctx.plan} k={k} selected={mapRoom} onSelect={live ? chooseRoom : undefined} people={planPeople}
            heat={false} order={null} sides />
        </div>
        <p className="small muted">Click a room on the plan or use the room list above. The orange outline shows the selected room.</p>
        <form className="inline manual-person" onSubmit={addManualPerson}>
          <input value={personName} onChange={(e) => setPersonName(e.target.value)} placeholder="Add a person (e.g. caller)" aria-label="Person description" disabled={!live} />
          <select className="sel" value={personRoom} onChange={(e) => setPersonRoom(e.target.value)} aria-label="New person's room" disabled={!live}>
            {rooms.map((room) => <option key={room.id} value={room.id}>{room.label}</option>)}
          </select>
          <button className="btn f" disabled={!live || !personName.trim() || !personRoom}>Add person</button>
        </form>
        <div><h2>How this works</h2><p className="note">Caller updates continue to reshape the plan. Manual room assignments stay in place until cleared; new people detected in the transcript still appear automatically.</p>
          {r && <p className="note">Extractor: {r.extractor}</p>}</div>
      </div>
    </div>
  )
}


const routeHeadline = (o, dir) => {
  if (!o) return ''
  const via = o.kind === 'window' ? `side ${o.side || '?'} window` : `side ${o.side || '?'} door`
  const verb = dir === 'in' ? (o.kind === 'window' ? 'Enter (VES)' : 'Enter') : (o.kind === 'window' ? 'Exit (VES)' : 'Out')
  return `${verb} ${via} · ${o.distance_m ?? '?'} m · ~${o.time_s ?? '?'} s`
}
const routePath = (o, k) => {
  if (!o?.path?.length) return ''
  return o.path.map((id) => k.label(id)).join(' → ')
}
const routeKey = (o) => o ? `${o.kind}:${o.id}` : null

function RouteOption({ option, k, direction, recommended, selected, onClick }) {
  const isBest = routeKey(option) === routeKey(recommended)
  return (
    <button type="button" aria-pressed={!!selected} className={`row stack route-choice ${selected ? 'sel' : ''}`} onClick={onClick}>
      <span className={`sh ${direction === 'in' ? 'in' : 'out'}`}>{direction === 'in' ? 'IN' : 'OUT'}</span>
      <div><b>{routeHeadline(option, direction)}</b><small>{routePath(option, k)}</small>
        {(option.kind === 'window' || option.through_untenable?.length || option.flow_path_warning || option.inferred) && <small className="route-details">{option.text}</small>}
        {option.through_untenable?.length > 0 && <small className="err">Crosses an untenable room: {option.through_untenable.map((id) => k.label(id)).join(', ')}</small>}
        {(isBest || selected) && <span className="route-badge">{isBest ? 'Recommended' : 'Selected'}</span>}</div>
    </button>
  )
}

// ---------- Rescue ----------
export function RescuePage({ ctx, k, go }) {
  const people = k.rescuePeople || []
  const [personId, setPersonId] = useState(people[0]?.id || null)
  const [mode, setMode] = useState('2d')
  const [walkClip, setWalkClip] = useState(null)
  const [walkLoading, setWalkLoading] = useState(false)
  const [walkError, setWalkError] = useState(null)
  const [entryId, setEntryId] = useState(null)
  const [exitId, setExitId] = useState(null)
  const [heatVisible, setHeatVisible] = useState(true)
  const person = people.find((p) => p.id === personId) || people[0] || null
  useEffect(() => {
    setEntryId(null)
    setExitId(null)
    setWalkClip(null)
    setWalkError(null)
  }, [person?.id])
  const recommended = person?.recommended_route
  const bestEntry = recommended?.entry || person?.entry
  const bestExit = recommended?.extraction || person?.extraction
  const entry = (person?.entry_options || []).find((o) => routeKey(o) === entryId) || bestEntry
  const extraction = (person?.extraction_options || []).find((o) => routeKey(o) === exitId) || bestExit
  const rescueRoutes = [
    entry?.polyline && { polyline: entry.polyline, cls: 'in', startLabel: `ENTRY ${entry.side || '?'}` },
    extraction?.polyline && { polyline: extraction.polyline, cls: 'out', endLabel: `EXIT ${extraction.side || '?'}` },
  ].filter(Boolean)
  const selectedRoute = person?.located && (entry || extraction) ? { entry, extraction, person } : null
  const canWalk = !!(extraction?.kind === 'door' && person?.located)
  const [picked, setPicked] = useState(ctx.params.room || null)
  const sel = picked || person?.room_id || k.victim || k.plan_[0]?.room_id
  const heat = ctx.briefing.heat
  const source = person?.manual || person?.location_source === 'manual' ? 'Manual location' : 'From audio'
  const totalTime = entry && extraction ? entry.time_s + extraction.time_s : null
  const totalDistance = entry && extraction ? entry.distance_m + extraction.distance_m : null
  const choosePerson = (id) => {
    setPersonId(id)
    setWalkClip(null)
    setWalkError(null)
  }
  const walkToExit = async () => {
    if (!person?.room_id || !extraction) return
    setWalkLoading(true)
    setWalkError(null)
    try {
      const tour = await getTour(ctx.buildingId, person.room_id, {
        exit: extraction.id,
        avoid: k.fireIds || [],
      })
      setWalkClip({ data: tour.out, label: `${person.description} · ${tour.room_label}` })
      setMode('3d')
    } catch (e) {
      setWalkError(`Could not load the exit walkthrough: ${e.message}`)
    } finally {
      setWalkLoading(false)
    }
  }

  return (
    <div className="page split rescue-layout">
      <div className="col rescue-sidebar">
        {person ? (
          <div className="sign r rescue-person-sign"><div className="trow">{person.room_confidence != null && <Ring p={person.room_confidence} />}
            <div><small>Rescue · priority {person.priority || '—'}</small><div className="big">{person.label || (person.room_id ? k.label(person.room_id) : 'Location unknown')}</div>
              <div className="sub">{person.description}{person.zone ? ` · ${person.zone}` : ''}</div>
              <div className="rescue-source">{source}{person.room_confidence != null ? ` · ${Math.round(person.room_confidence * 100)}% location confidence` : ''}</div></div></div></div>
        ) : k.victim ? (
          <div className="sign r"><div className="trow">{k.victimConf != null && <Ring p={k.victimConf} />}<div><small>Trapped · from the caller</small><div className="big">{k.victimLabel}</div>{k.victimWords && <div className="sub">“{k.victimWords}”</div>}</div></div></div>
        ) : <div className="sign"><div><small>Trapped</small><div className="big">Not reported yet</div></div></div>}

        {people.length > 0 && (
          <div className="panel rescue-people"><h2>People to locate <span>{people.length}</span></h2>
            {people.map((p) => (
              <button key={p.id} className={`row ${p.id === person?.id ? 'sel' : ''}`} onClick={() => choosePerson(p.id)}>
                <span className={`sh ${p.located ? 'r' : 'o'}`}>{p.priority || '—'}</span>
                <div><b>{p.description}</b><small>{p.label || (p.room_id ? k.label(p.room_id) : 'Location not matched yet')}{p.total_time_s ? ` · ~${p.total_time_s}s` : ''}</small></div>
              </button>
            ))}
          </div>
        )}

        {person && (
          <div className="panel grow rescue-options">
            <h2>Recommended operation <span>recalculated live</span></h2>
            <p className="note">The rescue planner ranks floor-plan paths by estimated time and modeled fire exposure. Verify conditions on scene.</p>
            {person.located && !selectedRoute && <p className="rescue-warning">No usable entry or extraction route is currently available for this person.</p>}
            {!person.located && <p className="rescue-warning">Location is not matched to a scanned room yet. Continue the call or assign a room in Dispatch Facts.</p>}
            {person.located && <>
              <div className="rescue-route-group">
                <h3>Way in <span>crew to person</span></h3>
                {entry && <RouteOption option={entry} k={k} direction="in" recommended={bestEntry} selected
                  onClick={() => setEntryId(routeKey(entry))} />}
                {!person.entry_options?.length && <p className="empty">No known entry reaches this room.</p>}
                {(person.entry_options || []).filter((o) => routeKey(o) !== routeKey(entry)).length > 0 && (
                  <details className="route-alternatives">
                    <summary>Other entries · {(person.entry_options || []).length - 1}</summary>
                    {(person.entry_options || []).filter((o) => routeKey(o) !== routeKey(entry)).map((o) => (
                      <RouteOption key={`in-${routeKey(o)}`} option={o} k={k} direction="in" recommended={bestEntry} onClick={() => { setEntryId(routeKey(o)); setWalkClip(null) }} />
                    ))}
                  </details>
                )}
              </div>
              <div className="rescue-route-group">
                <h3>Way out <span>person to safety</span></h3>
                {extraction && <RouteOption option={extraction} k={k} direction="out" recommended={bestExit} selected
                  onClick={() => setExitId(routeKey(extraction))} />}
                {!person.extraction_options?.length && <p className="empty">No known extraction reaches safety.</p>}
                {(person.extraction_options || []).filter((o) => routeKey(o) !== routeKey(extraction)).length > 0 && (
                  <details className="route-alternatives">
                    <summary>Other exits · {(person.extraction_options || []).length - 1}</summary>
                    {(person.extraction_options || []).filter((o) => routeKey(o) !== routeKey(extraction)).map((o) => (
                      <RouteOption key={`out-${routeKey(o)}`} option={o} k={k} direction="out" recommended={bestExit} onClick={() => { setExitId(routeKey(o)); setWalkClip(null) }} />
                    ))}
                  </details>
                )}
              </div>
            </>}
            <div className="row-btns">
              <button className="btn f wide" disabled={!canWalk || walkLoading} onClick={walkToExit}>{walkLoading ? 'Preparing walkthrough…' : 'Walk person to exit'}</button>
            </div>
            {person.located && extraction?.kind === 'window' && <p className="note">3D walkthroughs currently support door exits only. Choose a door under “Other exits” to walk that route.</p>}
            {walkError && <p className="err">{walkError}</p>}
            {k.heatMinutes != null && <p className="note">Modeled fire spread: ~{k.heatMinutes} min into the call.</p>}
          </div>
        )}

        {!people.length && (
          <div className="panel grow"><h2>Search order <span>tap a room</span></h2>
            {k.plan_.map((s, i) => (
              <button key={s.room_id} className={`row ${s.room_id === sel ? 'sel' : ''}`} onClick={() => setPicked(s.room_id)}>
                <span className={`sh ${s.room_id === k.victim ? 'r' : ''}`}>{i + 1}</span><div><b>{k.label(s.room_id)}</b><small>{s.reason}</small></div>
                <span className="d">{k.routeOf(s.room_id) ? `${k.routeOf(s.room_id).distance_m} m` : ''}</span>
              </button>
            ))}
          </div>
        )}
      </div>
      <div className="panel col rescue-map-panel">
        <div className="rescue-map-header">
          <div><h2>Rescue route <span>{person ? `for ${person.description}` : 'live floor plan'}</span></h2>
            <p className="note">{person?.located ? `${k.label(person.room_id)} · ${source} · tap a person marker to switch routes` : 'Tap a person marker to show their route. Locations update as the call identifies people.'}</p></div>
          <div className="chips">
            <div className="seg"><button className={mode === '2d' ? 'on' : ''} onClick={() => setMode('2d')}>2D</button><button className={mode === '3d' ? 'on' : ''} onClick={() => setMode('3d')}>3D</button></div>
            <button type="button" className={`chip heat-toggle ${heatVisible ? 'on' : ''}`} disabled={!heat?.rooms} onClick={() => setHeatVisible((v) => !v)}>{heatVisible ? 'Heat on' : 'Heat off'}</button>
          </div>
        </div>
        {person?.located && <div className="rescue-route-summary">
          <span className="rescue-route-summary-label">Selected operation</span>
          <strong>{entry && extraction ? `${entry.kind === 'window' ? 'Window' : 'Door'} ${entry.side || '?'} → ${extraction.kind === 'window' ? 'window' : 'door'} ${extraction.side || '?'}` : 'Route unavailable'}</strong>
          <span>{totalDistance != null ? `${totalDistance.toFixed(1)} m` : '—'} total · {totalTime != null ? `~${totalTime} s` : 'no time estimate'}</span>
        </div>}
        <div className="grow rescue-map">
          {mode === '3d'
            ? <Viewer3D building={ctx.building} plan={ctx.plan} layers={{ order: false, routes: true, doors: true, heat: false, windows: true }}
                searchOrder={{}} trapped={ctx.briefing.trapped || []} fireRooms={ctx.briefing.fire_room_ids}
              selected={null} onSelect={setPicked} highlight={null} mayday={null} evac={null}
                heat={heat} fireHeat={heatVisible} rescuePeople={people} selectedPersonId={person?.id} onPersonSelect={choosePerson}
                selectedRoute={selectedRoute} clip={walkClip} onClipClose={() => setWalkClip(null)} />
            : <PlanSvg plan={ctx.plan} k={k} selected={sel} onSelect={setPicked} danger={heatVisible}
                selectedPersonId={person?.id}
                people={people.map((p) => ({ id: p.id, at: p.position || k.R[p.room_id]?.centroid, label: p.description, located: p.located, selected: p.id === person?.id }))}
                onPersonSelect={choosePerson}
                rescueRoutes={rescueRoutes.length ? rescueRoutes : undefined}
                routes={!person && !rescueRoutes.length && sel && k.routeOf(sel) ? [k.routeOf(sel).polyline] : []}
                order={Object.fromEntries(k.plan_.map((s, i) => [s.room_id, i + 1]))} />}
        </div>
        <div className="rescue-legend">
          <span><i className="legend-line in" /> Way in</span><span><i className="legend-line out" /> Way out</span>
          {heatVisible && heat?.rooms && <><span><i className="legend-heat caution" /> Modeled spread</span><span><i className="legend-heat untenable" /> Untenable</span></>}
          <span className="muted">Heat is modeled from caller-reported fire, not a sensor.</span>
        </div>
      </div>
    </div>
  )
}

// ---------- Entry ----------
export function EntryPage({ ctx, k, go }) {
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
      <div className="panel col"><h2>Doors <span>white squares are exits</span></h2><div className="grow"><PlanSvg plan={ctx.plan} k={k} hiDoors={[sel]} bigExits /></div>
        {sel && k.victim && <button className="btn f wide" style={{ flex: 'none' }} onClick={() => go('model', { room: k.victim, entry: sel, clip: 'in' })}><Icon name="model" />Watch this door to {k.victimLabel} in 3D<Icon name="arrow" /></button>}</div>
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
      <div className="panel"><h2>Know before you trust it</h2><Freshness age={k.age} />{k.caveats.map((c, i) => <div key={i} className="row one"><span>{c}</span></div>)}</div>
    </div>
  )
}

// ---------- Aerial photos ----------
export function AerialPage({ ctx, k }) {
  const imgs = ctx.briefing.images || {}
  const front = k.bld.front || 'S'
  // open on the wall that's burning when we know it, otherwise the front
  const fireView = k.fireKnown && k.side ? viewOfCompass(['N', 'E', 'S', 'W'].find((c) => sideOfCompass(front, c) === k.side)) : null
  const first = [fireView, k.frontView].find((x) => x && x in imgs) || Object.keys(imgs)[0]
  const [v, setV] = useState(ctx.params.view in imgs ? ctx.params.view : first)
  useEffect(() => { if (fireView && fireView in imgs) setV(fireView) }, [fireView]) // eslint-disable-line react-hooks/exhaustive-deps
  const order = ['nadir', ...['A', 'B', 'C', 'D'].map((s) => viewOfCompass(['N', 'E', 'S', 'W'].find((c) => sideOfCompass(front, c) === s)))].filter((x) => x in imgs)
  return (
    <div className="page"><div className="panel col full">
      <div className="seg">{order.map((x) => <button key={x} className={v === x ? 'on' : ''} onClick={() => setV(x)}>{viewLabel(x, front)}{k.fireKnown && x !== 'nadir' && viewLabel(x, front)[0] === k.side ? ' · fire' : ''}</button>)}</div>
      {imgs[v] ? <AerialView view={v} src={imgs[v]} k={k} /> : <p className="empty">No aerial images for this building.</p>}
    </div></div>
  )
}

// ---------- Floor plan (2D / 3D) ----------
const LAYERS = [['order', 'Search order'], ['routes', 'Exit routes'], ['doors', 'Doors'], ['heat', 'Maze heat']]
export function PlanPage({ ctx, k, go, start3d = false }) {
  const [mode, setMode] = useState(start3d || ctx.params.clip || ctx.params.mode === '3d' ? '3d' : '2d'); const [sel, setSelRoom] = useState(ctx.params.room || null)
  const [selectedPersonId, setSelectedPersonId] = useState(ctx.params.person || null)
  // guided clips: which door to enter by, the clip data for the picked room, and what is playing now
  const [entry, setEntry] = useState(ctx.params.entry || null); const [tour, setTour] = useState(null); const [run, setRun] = useState(null)
  const setSel = (id) => { setSelRoom(id); setSelectedPersonId(null); setRun(null) }
  const choosePerson = (id) => {
    const person = k.rescuePeople.find((p) => p.id === id)
    if (!person) return
    setSelectedPersonId(id)
    if (person.room_id) setSelRoom(person.room_id)
    setRun(null)
  }
  const selectedPerson = k.rescuePeople.find((p) => p.id === selectedPersonId)
  const personEntry = selectedPerson?.recommended_route?.entry || selectedPerson?.entry
  const personExit = selectedPerson?.recommended_route?.extraction || selectedPerson?.extraction
  const selectedRoute = selectedPerson ? { entry: personEntry, extraction: personExit, person: selectedPerson } : null
  const roleOf = Object.fromEntries((ctx.briefing.entry_points || []).map((e) => [e.door_id, e.role]))
  const recommended = sel && sel === k.victim ? (ctx.briefing.entry_points || []).find((e) => e.role === 'search')?.door_id : null
  useEffect(() => {
    if (!sel) { setTour(null); return undefined }
    let alive = true; setTour(null)
    getTour(ctx.buildingId, sel, { entry: entry || recommended || undefined, avoid: ctx.briefing.fire_room_ids || [] })
      .then((d) => alive && setTour(d)).catch(() => alive && setTour(null))
    return () => { alive = false }
  }, [sel, entry, recommended, ctx.buildingId]) // eslint-disable-line react-hooks/exhaustive-deps
  // way out of the picked room, steering around rooms on fire (falls back to the plan's route)
  const fireKey = (k.fireIds || []).join(',')
  const [out, setOut] = useState(null)
  useEffect(() => {
    if (!sel) { setOut(null); return undefined }
    let alive = true
    getRoute(ctx.buildingId, sel, k.fireIds || []).then((r) => alive && setOut(r)).catch(() => alive && setOut(null))
    return () => { alive = false }
  }, [sel, fireKey, ctx.buildingId]) // eslint-disable-line react-hooks/exhaustive-deps
  const play = (legs) => { setMode('3d'); setRun({ legs, i: 0 }) }
  const clip = useMemo(() => (run && tour ? { data: tour[run.legs[run.i]], label: tour.room_label } : null), [run, tour])
  const clipEnd = () => setTimeout(() => setRun((r) => (r && r.i + 1 < r.legs.length ? { ...r, i: r.i + 1 } : r)), 1200)
  const autoplayed = useRef(false)
  useEffect(() => {
    if (tour && ctx.params.clip && !autoplayed.current) { autoplayed.current = true; play(ctx.params.clip === 'both' ? ['in', 'out'] : [ctx.params.clip]) }
  }, [tour]) // eslint-disable-line react-hooks/exhaustive-deps
  const [L, setL] = useState({ order: true, routes: true, doors: true, heat: false, windows: false })
  const order = L.order ? Object.fromEntries(k.plan_.map((s, i) => [s.room_id, i + 1])) : null
  const md = sel && ctx.plan.maze_detail?.[sel]
  const rescueRoutes = L.routes && selectedRoute ? [
    personEntry?.polyline && { polyline: personEntry.polyline, cls: 'in', startLabel: `ENTRY ${personEntry.side || '?'}` },
    personExit?.polyline && { polyline: personExit.polyline, cls: 'out', endLabel: `EXIT ${personExit.side || '?'}` },
  ].filter(Boolean) : []
  const routes = L.routes && !selectedRoute && sel
    ? [(out?.from_room_id === sel ? out : k.routeOf(sel))?.polyline].filter(Boolean)
    : []
  const routeForPanel = selectedRoute && personExit
    ? { ...personExit, from_room_id: selectedPerson.room_id, exit_door_id: personExit.kind === 'door' ? personExit.id : null }
    : out
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
                selected={sel} onSelect={setSel} highlight={null} mayday={ctx.feed.mayday} evac={null}
                rescuePeople={k.rescuePeople} selectedPersonId={selectedPerson?.id} onPersonSelect={choosePerson} selectedRoute={selectedRoute}
                clip={clip} onClipEnd={clipEnd} onClipClose={() => setRun(null)} />
            : <PlanSvg plan={ctx.plan} k={k} selected={sel} onSelect={setSel} order={order} doors={L.doors} heat={L.heat}
                routes={routes} rescueRoutes={rescueRoutes.length ? rescueRoutes : undefined}
                people={k.rescuePeople.map((p) => ({ id: p.id, at: p.position || k.R[p.room_id]?.centroid, label: p.description, located: p.located }))}
                selectedPersonId={selectedPerson?.id} onPersonSelect={choosePerson} />}
        </div>
      </div>
      <div className="panel">
        {sel ? <>
          <h2>Selected room</h2><div className="title">{k.label(sel)}</div>
          <p className="note">{k.R[sel].type} · {k.R[sel].area_m2} m² · side {k.R[sel].side}</p>
          <div className="maze"><span>Maze score</span><div className="bar big"><i style={{ width: `${(ctx.plan.maze_score?.[sel] || 0) * 100}%` }} /></div><b>{(ctx.plan.maze_score?.[sel] || 0).toFixed(2)}</b></div>
          {(md?.why || []).map((w, i) => <div key={i} className="row one"><span>{w}</span></div>)}
          {routeForPanel?.from_room_id === sel && <WayOut r={routeForPanel} k={k} base={ctx.plan.exit_routes?.[sel]} onFire={k.fireIds.includes(sel)} />}
          {tour && (
            <div className="tourpick">
              <h2>Guided clips <span>the camera walks it for you</span></h2>
              <label className="note" htmlFor="tour-entry">Enter by</label>
              <select id="tour-entry" className="sel" style={{ margin: 0 }} value={tour.entry.door_id} onChange={(e) => setEntry(e.target.value)}>
                {tour.entries.map((e) => <option key={e.door_id} value={e.door_id}>Side {e.side} door · {Math.round(e.distance_m)} m{roleOf[e.door_id] ? ` · ${roleOf[e.door_id]}` : ''}</option>)}
              </select>
              <div className="btns">
                <button className="btn f" onClick={() => play(['in'])}><Icon name="play" />Way in <small>{Math.round(tour.in.distance_m)} m</small></button>
                <button className="btn" onClick={() => play(['out'])}><Icon name="play" />Way out <small>{Math.round(tour.out.distance_m)} m</small></button>
              </div>
              <button className="btn wide" style={{ height: 44, flex: 'none' }} onClick={() => play(['in', 'out'])}><Icon name="play" />In and out</button>
            </div>
          )}
          <button className="btn red wide" onClick={() => go('mayday', { room: sel })}>Mayday from here<Icon name="arrow" /></button>
        </> : <><h2>Floor plan</h2><p className="note big">Tap any room for its maze score, exit route and mayday directions.</p></>}
      </div>
    </div>
  )
}

// Exit route for the picked room, and what the fire did to it
function WayOut({ r, k, base, onFire }) {
  const side = k.doors[r.exit_door_id || (r.kind === 'door' ? r.id : null)]?.side || r.side
  const extra = base ? Math.round(r.distance_m - base.distance_m) : 0
  const blocked = (r.through_avoided || r.through_untenable || []).map((id) => k.label(id))
  const tone = blocked.length || onFire ? 'r' : r.rerouted ? 'f' : ''
  const note = onFire ? 'This room is on fire.'
    : blocked.length ? `Only way out runs through ${blocked.join(' and ')}, which is on fire.`
      : r.rerouted ? `Rerouted around the fire${extra > 0 ? `, ${extra} m longer` : ''}.`
        : k.fireIds.length ? 'Clear of the fire.' : null
  return (
    <div className={`wayout ${tone}`}>
      <span>Way out</span><b>{Math.round(r.distance_m)} m{side ? ` · side ${side} door` : ''}</b>
      {note && <small>{note}</small>}
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
    return () => { alive = false; voiceLine.current?.stop() }
  }, [room, ctx.buildingId])
  const voiceLine = useRef(null); const [saying, setSaying] = useState(false); const [vErr, setVErr] = useState(null)
  const say = (t) => {
    voiceLine.current?.stop(); setVErr(null); setSaying(true)
    const h = speak(t, { voice: 'briefing' }); voiceLine.current = h
    h.finished.then((why) => { if (voiceLine.current === h) { setSaying(false); if (why === 'error') setVErr('ElevenLabs voice unavailable') } })
  }
  // fetch the voice for every step as soon as the directions arrive, so Speak is instant
  useEffect(() => { if (m?.directions) prepareInOrder(m.directions, 'briefing') }, [m])
  useEffect(() => () => voiceLine.current?.stop(), [])
  const n = m?.directions?.length || 0; const wp = m?.wall_path || []; const cut = n ? Math.round(wp.length * stepI / n) : 0
  return (
    <div className="page split" style={{ gridTemplateColumns: '1fr 480px' }}>
      <div className="col">
        <select className="sel big" value={room} onChange={(e) => setRoom(e.target.value)}>
          {ctx.plan.rooms.filter((r) => r.type !== 'void').map((r) => <option key={r.id} value={r.id}>Last known room: {r.label} · side {r.side}</option>)}
        </select>
        {(err || vErr) && <p className="err">{err || vErr}</p>}
        {m && <>
          <div className="sign"><div><small>Hand on wall</small><div className="big">{m.hand[0].toUpperCase() + m.hand.slice(1)} hand · {m.distance_m} m to side {m.exit_side} exit</div><div className="sub">Passes {m.doors_passed} door{m.doors_passed === 1 ? '' : 's'} · shortest path {m.shortest_m} m</div></div></div>
          <div className="panel grow steps">{m.directions.map((d, i) => <button key={i} className={`st ${i < stepI ? 'done' : i === stepI ? 'now' : ''}`} onClick={() => setStep(i)}><i>{i + 1}</i>{d}</button>)}</div>
        </>}
      </div>
      <div className="col">
        <div className="panel grow flat">{m && <PlanSvg plan={ctx.plan} k={k} selected={room} dashed={wp.slice(Math.max(cut - 1, 0))} walked={cut > 1 ? wp.slice(0, cut) : null} />}</div>
        <div className="row-btns">
          <button className="btn" onClick={() => setStep(Math.max(0, stepI - 1))} disabled={!stepI} aria-label="Previous step"><Icon name="back" /></button>
          <button className="btn wide" onClick={() => m && say(m.directions[stepI])}><Icon name="speak" />{saying ? 'Speaking…' : 'Speak step'}</button>
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
  const located = k.rescuePeople.filter((p) => p.located).length
  const awaiting = k.rescuePeople.length - located
  const status = { call: 'Transcript, replay or live mic', facts: 'Structured record with confidence',
    rescue: located ? `${located} located${awaiting ? ` · ${awaiting} awaiting a room` : ''}` : awaiting ? `${awaiting} reported · location pending` : `Search ${k.plan_.length} rooms`,
    entry: `${k.search ? `Side ${k.search.side} search door` : 'Entry doors'}`, hazards: k.watch ? k.watch.text : 'Hazards with sources', hose: k.hose ? `${k.hose.total_ft} ft to the fire` : 'Hose lengths',
    exterior: 'Roof, ladders, caveats', aerial: 'Photos from every side', model: 'Walk the scanned interior', plan: '2D and 3D',
    mayday: 'Wall-follow out of any room', evac: 'Occupants to exits', ask: 'Questions about the building' }
  const groupDescription = {
    Incident: 'Capture the call and confirm the facts shaping the briefing.',
    Response: 'Plan entry, locate people, and move crews safely.',
    Building: 'Inspect the structure, hazards, imagery, and floor plan.',
  }
  const groups = [...new Set(pages.map((p) => p.group))]
  return (
    <div className="page all-tools-page">
      <header className="all-heading">
        <div><span className="eyebrow">Scanferno workspace</span><h1>All tools</h1><p>One place for every incident, response, and building feature.</p></div>
        <div className="all-count"><b>{pages.length}</b><span>features</span></div>
      </header>
      <div className="gantry">
      {groups.map((g) => (
        <div key={g} className="group"><h2>{g}</h2>
          <p className="group-description">{groupDescription[g]}</p>
          {pages.filter((p) => p.group === g).map((p) => (
            <button key={p.id} className={`dest ${p.alert ? 'alert' : ''}`} onClick={() => go(p.id)}>
              <div className="top"><span className="plate"><Icon name={p.id} /></span><Icon name="arrow" /></div>
              <div><b>{p.name}</b><span className="s">{status[p.id]}</span></div>
            </button>
          ))}
        </div>
      ))}
      </div>
    </div>
  )
}
