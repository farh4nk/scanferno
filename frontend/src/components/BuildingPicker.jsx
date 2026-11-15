import { useEffect, useMemo, useState } from 'react'
import { prepareOnDemand, search } from '../api'

// Which building the live test is about. The buildings that are ready come first; every other building that CoStar
// has and Matterport has scanned is listed too, and is set up (floor plan, doors, exits) the moment you pick it.
export default function BuildingPicker({ buildings, currentId, onPick }) {
  const [catalog, setCatalog] = useState([])
  const [q, setQ] = useState('')
  const [busy, setBusy] = useState(null)
  const [err, setErr] = useState(null)

  useEffect(() => {
    let on = true
    search('', { limit: 100, filters: { status: 'scanned', costar: true } }).then((d) => on && setCatalog(d.results || [])).catch(() => {})
    return () => { on = false }
  }, [])

  const rows = useMemo(() => {
    const ready = buildings.map((b) => ({ id: b.id, name: b.name, sub: b.address, ready: true }))
    const have = new Set(buildings.map((b) => b.id))
    const more = catalog.filter((c) => !have.has(c.id)).map((c) => ({
      id: c.id, name: c.name, ready: false, sub: [c.city, c.scan?.rooms ? `${c.scan.rooms} rooms` : null, c.stories ? `${c.stories} stories` : null].filter(Boolean).join(' · '), city: c.city,
    })).sort((a, b) => (b.city === 'Houston') - (a.city === 'Houston'))
    const needle = q.trim().toLowerCase()
    return [...ready, ...more].filter((r) => !needle || `${r.name} ${r.sub}`.toLowerCase().includes(needle))
  }, [buildings, catalog, q])

  const pick = async (row) => {
    setErr(null)
    if (row.ready) { onPick(row.id); return }
    setBusy(row.id)
    try { const r = await prepareOnDemand(row.id); onPick(r.building_id || row.id) } catch (e) { setErr(`${row.name}: ${e.message}`) } finally { setBusy(null) }
  }

  return (
    <div className="bpick">
      <h4>Where is the fire? <span>{buildings.length} ready · {catalog.length} more from CoStar</span></h4>
      <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search by name, street or city" aria-label="Search buildings" />
      <div className="blist" role="listbox" aria-label="Buildings">
        {rows.map((r) => (
          <button key={r.id} role="option" aria-selected={r.id === currentId} className={`brow ${r.id === currentId ? 'on' : ''}`} onClick={() => pick(r)} disabled={!!busy}>
            <i aria-hidden="true" />
            <span><b>{r.name}</b><small>{r.sub}</small></span>
            <em>{busy === r.id ? 'Setting up…' : r.ready ? 'ready' : 'set up on pick'}</em>
          </button>
        ))}
        {!rows.length && <p className="muted">No building matches “{q}”.</p>}
      </div>
      {err && <p className="err small">{err}</p>}
    </div>
  )
}
