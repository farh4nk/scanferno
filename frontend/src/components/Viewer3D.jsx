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

export default function Viewer3D({
  building, plan, layers, searchOrder, trapped, fireRooms, selected, onSelect, highlight, mayday, evac,
}) {
  const box = useRef(null)
  const [viewer, setViewer] = useState(null)
  const [status, setStatus] = useState(SDK_KEY ? 'Loading 3D model…' : '')
  const [err, setErr] = useState(null)
  const [view, setView] = useState('dollhouse')
  // where the camera stands in walk mode; room is kept from the last sweep that was inside a room
  const [here, setHere] = useState(null)
  // the picked room and the sweep we flew to for it; that sweep can sit outside a room that was never scanned from inside
  const [anchor, setAnchor] = useState(null)
  const [heading, setHeading] = useState(null)
  const player = useRef(null)
  const viewRef = useRef(view)
  viewRef.current = view
  const onSelectRef = useRef(onSelect)
  onSelectRef.current = onSelect
  const lastWalked = useRef(null)
  // the viewer that is still connected; effects can run with a `viewer` that was destroyed in the same commit
  const liveViewer = useRef(null)

  const walkTo = (v, roomId) => {
    if (!v || v !== liveViewer.current) return
    lastWalked.current = roomId
    setErr(null)
    v.walkTo(roomId).then((sweepId) => {
      if (v !== liveViewer.current) return
      if (sweepId) setAnchor({ roomId, sweepId })
      else setErr('No camera position found in that room')
    }).catch((e) => { if (v === liveViewer.current) setErr(`Could not walk to that room: ${e.message || e}`) })
  }

  // open the Matterport model for this building
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
        // in walk mode a click is Matterport's own navigation; elsewhere it picks a room and flies into it
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

  // redraw a named overlay layer
  const draw = (name, visible, fn) => {
    if (!viewer) return
    const layer = viewer.overlay.layer(name)
    layer.clear()
    if (visible) fn(layer, viewer.floorplan)
    layer.visible = visible
  }

  useEffect(() => { draw('rooms', true, (l, fp) => drawRooms(l, fp, layers.heat ? 'maze' : 'type')) }, [viewer, layers.heat])
  // room labels float at eye height, so in walk mode they would fill the screen
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
      for (const t of trapped) {
        const r = fp.rooms.find((x) => x.id === t.room_id)
        if (!r) continue
        l.marker(r.centroid, { shape: 'cone', radius: 0.3, size: 0.8, height: 1.4, color: '#ff2a2a', xray: true })
        l.label(r.centroid, 'TRAPPED', { height: 2.6, color: '#fecaca', size: 0.34 })
      }
    })
  }, [viewer, fireRooms, trapped])

  // a room picked anywhere (2D plan, briefing, 3D click) flies the camera into it
  useEffect(() => {
    if (viewer && selected && selected !== lastWalked.current) walkTo(viewer, selected)
    // eslint-disable-next-line
  }, [viewer, selected])

  const atAnchor = anchor && here?.sweepId === anchor.sweepId
  const walkRoute = walking ? plan?.exit_routes?.[(atAnchor ? anchor.roomId : here?.room?.id) ?? selected] : null
  const walkFrom = walkRoute && here?.room?.id === walkRoute.from_room_id ? here.local : undefined

  useEffect(() => {
    draw('route', true, (l, fp) => {
      if (walking) {
        if (walkRoute) drawRoute(l, walkRoute, fp, undefined, { from: walkFrom, xray: true })
        return
      }
      const targets = layers.routes ? trapped.map((t) => t.room_id) : []
      if (selected) targets.push(selected)
      for (const id of new Set(targets)) { const rt = fp.exit_routes?.[id]; if (rt) drawRoute(l, rt, fp) }
    })
  }, [viewer, selected, trapped, layers.routes, walking, walkRoute, walkFrom])

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

  const go = async (v) => {
    setView(v)
    setErr(null)
    if (v === 'inside' && selected && viewer) { walkTo(viewer, selected); return }
    try { await viewer?.setView(v) } catch (e) { setErr(`Showcase refused the ${v} view: ${e.message || e}`) }
  }

  const exitSide = walkRoute && plan.doors.find((d) => d.id === walkRoute.exit_door_id)?.side
  const walkLine = walkRoute && (walkFrom ? [walkFrom, ...walkRoute.polyline.slice(1)] : walkRoute.polyline)
  const walkInfo = walkRoute && `${plan.rooms.find((r) => r.id === walkRoute.from_room_id)?.label}: `
    + `${(walkFrom ? pathLength(walkLine) : walkRoute.distance_m).toFixed(0)} m to exit${exitSide ? ` ${exitSide}` : ''}`
  // point the way to the route 2 m ahead of the closest point on it, so it still helps when facing away
  const hint = walkLine && here && heading != null
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
