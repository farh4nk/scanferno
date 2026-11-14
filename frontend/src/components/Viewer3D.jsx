import { useEffect, useRef, useState } from 'react'
import {
  openBuilding, setApiBase, drawRooms, drawLabels, drawOutline, drawDoors, drawExits, drawWindows,
  drawRoute, drawMayday, highlightRooms, evacPlayer, pathLength, pointAlong, nearestAlong, turnHint,
} from '@viewer3d/index'
import { API } from '../api'

// __MP_SDK_KEY__ is injected by vite.config.js from MATTERPORT_SDK_KEY in the repo-root .env
// eslint-disable-next-line no-undef
const SDK_KEY = typeof __MP_SDK_KEY__ === 'string' ? __MP_SDK_KEY__ : ''
setApiBase(API)

const VIEWS = [['dollhouse', 'Dollhouse'], ['floorplan', 'Top'], ['inside', 'Walk']]
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

export default function Viewer3D({
  building, plan, layers, searchOrder, trapped, fireRooms, selected, onSelect, highlight, mayday, evac,
  heat = null, rescuePeople = null, selectedRoute = null, walkToken = 0,
}) {
  const box = useRef(null)
  const [viewer, setViewer] = useState(null)
  const [status, setStatus] = useState(SDK_KEY ? 'Loading 3D model…' : '')
  const [err, setErr] = useState(null)
  const [view, setView] = useState('dollhouse')
  const [here, setHere] = useState(null)
  const [anchor, setAnchor] = useState(null)
  const [heading, setHeading] = useState(null)
  const [walkPhase, setWalkPhase] = useState(null)
  const player = useRef(null)
  const viewRef = useRef(view)
  viewRef.current = view
  const onSelectRef = useRef(onSelect)
  onSelectRef.current = onSelect
  const lastWalked = useRef(null)
  const liveViewer = useRef(null)
  const walkGen = useRef(0)

  const walkTo = (v, roomId) => {
    if (!v || v !== liveViewer.current || !roomId) return Promise.resolve(null)
    lastWalked.current = roomId
    setErr(null)
    return v.walkTo(roomId).then((sweepId) => {
      if (v !== liveViewer.current) return null
      if (sweepId) setAnchor({ roomId, sweepId })
      else setErr('No camera position found in that room')
      return sweepId
    }).catch((e) => {
      if (v === liveViewer.current) setErr(`Could not walk to that room: ${e.message || e}`)
      return null
    })
  }

  useEffect(() => {
    if (!SDK_KEY || !building || !plan) return undefined
    let cancelled = false
    let v = null
    setViewer(null); setErr(null); setHere(null); setAnchor(null); setStatus('Loading 3D model…')
    lastWalked.current = null
    openBuilding(box.current, building, { sdkKey: SDK_KEY, floorplan: plan })
      .then(async (opened) => {
        if (cancelled) { opened.destroy(); return }
        v = opened
        liveViewer.current = opened
        opened.onMove((h) => {
          if (h.mode) setView(h.mode)
          setHere((prev) => (h.room || h.mode !== 'inside' ? h : { ...h, room: prev?.room ?? null }))
        })
        opened.onHeading(setHeading)
        opened.onPick((p) => {
          if (!p.room || viewRef.current === 'inside') return
          onSelectRef.current(p.room.id)
          walkTo(opened, p.room.id)
        })
        try { await opened.setView('dollhouse') } catch { /* view may be disabled for this model */ }
        const a = opened.alignment
        setStatus(`${a.saved ? 'Saved calibration' : `Auto-aligned: ${a.matched} rooms${a.rmsM != null ? `, ${a.rmsM} m RMS` : ''}`}`)
        setViewer(opened)
      })
      .catch((e) => { if (!cancelled) setErr(String(e.message || e)) })
    return () => {
      cancelled = true; player.current = null
      if (liveViewer.current === v) liveViewer.current = null
      v?.destroy(); setViewer(null)
    }
    // eslint-disable-next-line
  }, [building?.id, plan])

  const draw = (name, visible, fn) => {
    if (!viewer) return
    const layer = viewer.overlay.layer(name)
    layer.clear()
    if (visible) fn(layer, viewer.floorplan)
    layer.visible = visible
  }

  useEffect(() => { draw('rooms', true, (l, fp) => drawRooms(l, fp, layers.heat ? 'maze' : 'type')) }, [viewer, layers.heat])
  const walking = view === 'inside'
  useEffect(() => { draw('labels', !walking, (l, fp) => drawLabels(l, fp)); draw('outline', true, (l, fp) => drawOutline(l, fp)) }, [viewer, walking])
  useEffect(() => { draw('exits', layers.doors, (l, fp) => { drawDoors(l, fp); drawExits(l, fp) }) }, [viewer, layers.doors])
  useEffect(() => { draw('windows', layers.windows, (l, fp) => drawWindows(l, fp)) }, [viewer, layers.windows])

  useEffect(() => {
    draw('order', layers.order && !walking, (l, fp) => {
      for (const r of fp.rooms) if (searchOrder[r.id]) l.label(r.centroid, `#${searchOrder[r.id]}`, { height: 1.6, color: '#ffb02e', size: 0.4 })
    })
  }, [viewer, layers.order, searchOrder, walking])

  useEffect(() => {
    draw('incident', true, (l, fp) => {
      if (fireRooms?.length) highlightRooms(l, fp, fireRooms, '#ff7a1a', { pulse: true, label: 'FIRE' })
      const people = rescuePeople?.length ? rescuePeople : (trapped || []).map((t) => ({ ...t, position: null }))
      for (const t of people) {
        const r = fp.rooms.find((x) => x.id === t.room_id)
        if (!r) continue
        const at = t.position || r.centroid
        l.marker(at, { shape: 'cone', radius: 0.3, height: 0.8, color: '#ff2a2a', xray: true })
        l.label(at, (t.description || 'TRAPPED').split(' ')[0].toUpperCase(), { height: 2.6, color: '#fecaca', size: 0.34 })
      }
      if (heat?.zones?.untenable?.length) highlightRooms(l, fp, heat.zones.untenable, '#7f1d1d', { pulse: false })
    })
  }, [viewer, fireRooms, trapped, rescuePeople, heat])

  useEffect(() => {
    if (viewer && selected && selected !== lastWalked.current && !walkToken) walkTo(viewer, selected)
    // eslint-disable-next-line
  }, [viewer, selected])

  const atAnchor = anchor && here?.sweepId === anchor.sweepId
  const walkRoute = walking && !selectedRoute ? plan?.exit_routes?.[(atAnchor ? anchor.roomId : here?.room?.id) ?? selected] : null
  const walkFrom = walkRoute && here?.room?.id === walkRoute.from_room_id ? here.local : undefined

  useEffect(() => {
    draw('route', true, (l, fp) => {
      if (selectedRoute?.entry?.polyline) {
        drawRoute(l, { polyline: selectedRoute.entry.polyline, from_room_id: selectedRoute.person?.room_id }, fp, '#4dd0ff', { xray: walking })
      }
      if (selectedRoute?.extraction?.polyline) {
        drawRoute(l, { polyline: selectedRoute.extraction.polyline, from_room_id: selectedRoute.person?.room_id }, fp, '#7dffb3', { xray: walking })
      }
      if (selectedRoute) return
      if (walking) {
        if (walkRoute) drawRoute(l, walkRoute, fp, undefined, { from: walkFrom, xray: true })
        return
      }
      const targets = layers.routes ? trapped.map((t) => t.room_id) : []
      if (selected) targets.push(selected)
      for (const id of new Set(targets)) { const rt = fp.exit_routes?.[id]; if (rt) drawRoute(l, rt, fp) }
    })
  }, [viewer, selected, trapped, layers.routes, walking, walkRoute, walkFrom, selectedRoute])

  useEffect(() => {
    draw('mayday', true, (l, fp) => { if (mayday?.wall_path) drawMayday(l, mayday, fp) })
  }, [viewer, mayday])

  useEffect(() => {
    draw('selection', true, (l, fp) => {
      if (selected) highlightRooms(l, fp, [selected], '#facc15', { pulse: true })
      if (highlight?.rooms?.length) highlightRooms(l, fp, highlight.rooms, '#4dd0ff')
      for (const pl of highlight?.polylines || []) l.path(pl, { color: '#ffe14d', radius: 0.08, opacity: 0.95 })
    })
    if (viewer) viewer.overlay.layer('selection').visible = !walking
  }, [viewer, selected, highlight, walking])

  useEffect(() => {
    draw('evac', true, (l, fp) => {
      player.current = null
      if (evac) { player.current = evacPlayer(l, fp, evac); player.current.play() }
    })
  }, [viewer, evac])

  // Walk rescue: enter to victim room, pause, then exit along extraction path.
  useEffect(() => {
    if (!viewer || !selectedRoute?.person?.room_id || !walkToken) return undefined
    const gen = ++walkGen.current
    const person = selectedRoute.person
    const entryPath = selectedRoute.entry?.path || []
    const exitPath = selectedRoute.extraction?.path || []
    const enterRoom = entryPath[0] || person.room_id
    const exitRoom = [...exitPath].reverse().find((r) => r !== person.room_id) || exitPath.at(-1) || person.room_id

    ;(async () => {
      try {
        setWalkPhase('enter')
        setView('inside')
        try { await viewer.setView('inside') } catch { /* Showcase may refuse */ }
        if (walkGen.current !== gen) return
        await walkTo(viewer, enterRoom)
        if (walkGen.current !== gen) return
        if (enterRoom !== person.room_id) {
          await sleep(900)
          if (walkGen.current !== gen) return
          await walkTo(viewer, person.room_id)
        }
        if (walkGen.current !== gen) return
        setWalkPhase('save')
        await sleep(1600)
        if (walkGen.current !== gen) return
        setWalkPhase('exit')
        if (exitRoom && exitRoom !== person.room_id) await walkTo(viewer, exitRoom)
        if (walkGen.current !== gen) return
        setWalkPhase('done')
        setStatus('Rescue walk complete')
      } catch (e) {
        if (walkGen.current === gen) setErr(`Rescue walk failed: ${e.message || e}`)
      }
    })()
    return () => { walkGen.current += 1 }
    // eslint-disable-next-line
  }, [walkToken, viewer])

  const go = async (v) => {
    setView(v)
    setErr(null)
    if (v === 'inside' && selected && viewer) { walkTo(viewer, selected); return }
    try { await viewer?.setView(v) } catch (e) { setErr(`Showcase refused the ${v} view: ${e.message || e}`) }
  }

  const exitSide = walkRoute && plan.doors.find((d) => d.id === walkRoute.exit_door_id)?.side
  const walkLine = walkRoute && (walkFrom ? [walkFrom, ...walkRoute.polyline.slice(1)] : walkRoute.polyline)
  const walkInfo = selectedRoute
    ? (walkPhase === 'enter' ? 'Walking in to the victim…'
      : walkPhase === 'save' ? 'At victim — preparing exit…'
        : walkPhase === 'exit' ? 'Exiting with the victim…'
          : walkPhase === 'done' ? 'Rescue walk done'
            : selectedRoute.entry?.text)
    : walkRoute && `${plan.rooms.find((r) => r.id === walkRoute.from_room_id)?.label}: `
      + `${(walkFrom ? pathLength(walkLine) : walkRoute.distance_m).toFixed(0)} m to exit${exitSide ? ` ${exitSide}` : ''}`
  const hint = !selectedRoute && walkLine && here && heading != null
    && turnHint(heading, here.local, pointAlong(walkLine, Math.min(pathLength(walkLine), nearestAlong(walkLine, here.local) + 2)))

  if (!SDK_KEY) {
    return (
      <div className="viewer3d-msg">
        <b>3D model needs a Matterport Showcase SDK key.</b>
        <p>Add <code>MATTERPORT_SDK_KEY=…</code> (and <code>MATTERPORT_SDK_DOMAIN=localhost</code>) to the repo-root <code>.env</code>, then restart <code>npm run dev</code>. Ask a teammate for the key.</p>
      </div>
    )
  }

  return (
    <div className="viewer3d">
      <div className="viewer3d-bar">
        {VIEWS.map(([k, l]) => <button key={k} className={k === view ? 'on' : ''} disabled={!viewer} onClick={() => go(k)}>{l}</button>)}
        {hint && <span className="walk-hint" title={`Exit route: ${hint.text}`}>{hint.arrow} <small>{hint.text}</small></span>}
        {walkInfo && <span className="walk-info small">{walkInfo}</span>}
        <span className="muted small">{err ? '' : viewer ? (walkInfo ? '' : status) : 'Loading 3D model…'}</span>
        {err && <span className="err small">{err}</span>}
      </div>
      <div className="viewer3d-box" ref={box} />
    </div>
  )
}
