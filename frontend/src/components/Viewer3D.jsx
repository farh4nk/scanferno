import { useEffect, useRef, useState } from 'react'
import {
  openBuilding, setApiBase, drawRooms, drawLabels, drawOutline, drawDoors, drawExits, drawWindows,
  drawRoute, drawMayday, highlightRooms, evacPlayer,
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
  const player = useRef(null)

  // open the Matterport model for this building
  useEffect(() => {
    if (!SDK_KEY || !building || !plan) return undefined
    let cancelled = false
    let v = null
    setViewer(null); setErr(null); setStatus('Loading 3D model…')
    openBuilding(box.current, building, { sdkKey: SDK_KEY, floorplan: plan })
      .then(async (opened) => {
        if (cancelled) { opened.destroy(); return }
        v = opened
        opened.onPick((p) => { if (p.room) onSelect(p.room.id) })
        try { await opened.setView('dollhouse') } catch { /* view may be disabled for this model */ }
        const a = opened.alignment
        setStatus(`${a.saved ? 'Saved calibration' : `Auto-aligned: ${a.matched} rooms${a.rmsM != null ? `, ${a.rmsM} m RMS` : ''}`}`)
        setViewer(opened)
      })
      .catch((e) => { if (!cancelled) setErr(String(e.message || e)) })
    return () => { cancelled = true; player.current = null; v?.destroy(); setViewer(null) }
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
  useEffect(() => { draw('labels', true, (l, fp) => drawLabels(l, fp)); draw('outline', true, (l, fp) => drawOutline(l, fp)) }, [viewer])
  useEffect(() => { draw('exits', layers.doors, (l, fp) => { drawDoors(l, fp); drawExits(l, fp) }) }, [viewer, layers.doors])
  useEffect(() => { draw('windows', layers.windows, (l, fp) => drawWindows(l, fp)) }, [viewer, layers.windows])

  useEffect(() => {
    draw('order', layers.order, (l, fp) => {
      for (const r of fp.rooms) if (searchOrder[r.id]) l.label(r.centroid, `#${searchOrder[r.id]}`, { height: 1.6, color: '#ffb02e', size: 0.4 })
    })
  }, [viewer, layers.order, searchOrder])

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

  useEffect(() => {
    draw('route', true, (l, fp) => {
      const targets = layers.routes ? trapped.map((t) => t.room_id) : []
      if (selected) targets.push(selected)
      for (const id of new Set(targets)) { const rt = fp.exit_routes?.[id]; if (rt) drawRoute(l, rt, fp) }
    })
  }, [viewer, selected, trapped, layers.routes])

  useEffect(() => {
    draw('mayday', true, (l, fp) => { if (mayday?.wall_path) drawMayday(l, mayday, fp) })
  }, [viewer, mayday])

  useEffect(() => {
    draw('selection', true, (l, fp) => {
      if (selected) highlightRooms(l, fp, [selected], '#facc15', { pulse: true })
      if (highlight?.rooms?.length) highlightRooms(l, fp, highlight.rooms, '#4dd0ff')
      for (const pl of highlight?.polylines || []) l.path(pl, { color: '#ffe14d', radius: 0.08, opacity: 0.95 })
    })
  }, [viewer, selected, highlight])

  useEffect(() => {
    draw('evac', true, (l, fp) => {
      player.current = null
      if (evac) { player.current = evacPlayer(l, fp, evac); player.current.play() }
    })
  }, [viewer, evac])

  const go = async (v) => {
    setView(v)
    try { await viewer?.setView(v) } catch (e) { setErr(`Showcase refused the ${v} view: ${e.message || e}`) }
  }

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
        <span className="muted small">{err ? '' : viewer ? status : 'Loading 3D model…'}</span>
        {err && <span className="err small">{err}</span>}
      </div>
      <div className="viewer3d-box" ref={box} />
    </div>
  )
}
