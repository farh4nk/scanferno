import { useEffect, useState } from 'react'
import { getProperty, getPropertyVexcel, prepareOnDemand, propertyAerialUrl } from '../../api'

// Facts for a searched property. "Open briefing" onboards on demand (same process as heroes), then opens the floor plan / 3D view.
export default function PropertyCard({ property, onClose, onOpenBuilding }) {
  const [p, setP] = useState(property)
  const [err, setErr] = useState(null)
  const [vx, setVx] = useState(null)
  const [vxErr, setVxErr] = useState(null)
  const [imgOk, setImgOk] = useState(true)
  const [busy, setBusy] = useState(false)
  const key = property.id ?? property.costar_property_id

  useEffect(() => {
    setP(property); setErr(null); setVx(null); setVxErr(null); setImgOk(true); setBusy(false)
    getProperty(key).then(setP).catch((e) => setErr(e.message))
    if (property.lat != null) getPropertyVexcel(key).then(setVx).catch((e) => setVxErr(e.message))
  }, [property, key])

  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const openReady = async () => {
    if (p.status === 'ready' && p.building_id) {
      onOpenBuilding(p.building_id)
      return
    }
    setBusy(true); setErr(null)
    try {
      const r = await prepareOnDemand(key)
      onOpenBuilding(r.building_id)
    } catch (e) {
      setErr(e.message); setBusy(false)
    }
  }

  const c = p.costar || {}
  const roof = vx || p.vexcel
  const facts = [
    ['Type', p.property_type], ['Stories', p.stories], ['Current tenants', p.tenants],
    ['Year built', c.year_built], ['Construction', c.construction_material],
    ['Sprinklers', c.has_sprinklers == null ? null : c.has_sprinklers ? 'Yes' : 'No'],
    ['CoStar id', p.costar_property_id], ['3D scans', p.models_count],
    ['Largest scan', p.scan?.rooms ? `${p.scan.rooms} rooms` : null],
    ['Roof', roof?.roof_material && `${roof.roof_material}${roof.roof_shape ? `, ${roof.roof_shape}` : ''}`],
    ['Roof condition', roof?.roof_condition != null ? `${roof.roof_condition} / 5` : null],
    ['Footprint', roof?.footprint_area_m2 ? `${Math.round(roof.footprint_area_m2 * 10.764).toLocaleString()} sq ft` : null],
    ['Rooftop units', roof?.ac_units || null], ['Solar', roof ? (roof.solar ? 'Yes' : 'No') : null],
  ].filter(([, v]) => v != null && v !== '')

  return (
    <div className="modal-bg" onMouseDown={onClose}>
      <div className="card modal" onMouseDown={(e) => e.stopPropagation()}>
        <h3>Property <span className={`sr-status ${p.status}`}>{p.status === 'ready' ? 'briefing' : '3D scan'}</span>
          <button className="chip close" onClick={onClose} aria-label="Close">✕</button></h3>
        <h2 className="modal-title">{p.name}</h2>
        {p.address && p.address !== p.name && <p className="muted">{p.address}</p>}
        {err && <p className="err">{err}</p>}
        {p.lat != null && imgOk && (
          <img className="pc-aerial" src={propertyAerialUrl(key)} alt="Vexcel aerial view" onError={() => setImgOk(false)} />
        )}
        <div className="facts">{facts.map(([k, v]) => <div key={k}><span className="muted small">{k}</span><b>{v}</b></div>)}</div>
        {vxErr && <p className="small muted">Aerial data unavailable: {vxErr}</p>}
        {c.tenant_names?.length > 0 && <p className="small"><span className="muted">Tenants: </span>{c.tenant_names.slice(0, 8).join(', ')}</p>}
        {p.models?.length > 0 && (
          <>
            <h4>Matterport scans</h4>
            <div className="pc-scans">
              {p.models.slice(0, 12).map((m) => (
                <a key={m.id} className="row" href={`https://my.matterport.com/show/?m=${m.id}`} target="_blank" rel="noreferrer">
                  <span>{m.name || m.id}</span>
                  <span className="role">{m.rooms ? `${m.rooms} rooms` : ''}{m.floors > 1 ? ` · ${m.floors} floors` : ''}</span>
                </a>
              ))}
              {p.models.length > 12 && <p className="small muted">+{p.models.length - 12} more scans</p>}
            </div>
          </>
        )}
        {p.lat != null && (
          <p className="small"><a href={`https://www.openstreetmap.org/?mlat=${p.lat}&mlon=${p.lon}#map=18/${p.lat}/${p.lon}`} target="_blank" rel="noreferrer">
            Open on map ({p.lat.toFixed(5)}, {p.lon.toFixed(5)})</a></p>
        )}
        <button className="primary" disabled={busy || !p.scan?.model_id} onClick={openReady}>
          {busy ? 'Loading interior…' : 'Open briefing'}
        </button>
        {p.status !== 'ready' && !busy && (
          <p className="small muted">First open fetches the Matterport floor plan (a few seconds), then works offline like the hero buildings.</p>
        )}
        {p.nearest_ready?.length > 0 && (
          <>
            <h4>Nearest buildings with a briefing</h4>
            {p.nearest_ready.map((r) => (
              <div key={r.id} className="row click" onClick={() => onOpenBuilding(r.building_id)}>
                <span><b>{r.name}</b> <span className="muted">{r.address}</span></span>
                <span className="role">{(r.distance_m / 1000).toFixed(1)} km</span>
              </div>
            ))}
          </>
        )}
      </div>
    </div>
  )
}
