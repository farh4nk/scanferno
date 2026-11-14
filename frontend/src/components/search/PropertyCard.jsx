import { useEffect, useState } from 'react'
import { getProperty } from '../../api'

// Facts for a searched property that has no cached briefing yet, with a jump to the nearest one that does.
export default function PropertyCard({ property, onClose, onOpenBuilding }) {
  const [p, setP] = useState(property)
  const [err, setErr] = useState(null)

  useEffect(() => {
    setP(property); setErr(null)
    getProperty(property.costar_property_id ?? property.id).then(setP).catch((e) => setErr(e.message))
  }, [property])

  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const facts = [
    ['Type', p.property_type], ['Stories', p.stories], ['Current tenants', p.tenants],
    ['CoStar id', p.costar_property_id], ['Matterport scan', p.scan?.model_id],
    ['Scanned rooms', p.scan?.rooms], ['Scanned doorways', p.scan?.doorways],
  ].filter(([, v]) => v != null)

  return (
    <div className="modal-bg" onMouseDown={onClose}>
      <div className="card modal" onMouseDown={(e) => e.stopPropagation()}>
        <h3>Property <span className={`sr-status ${p.status}`}>{p.status === 'ready' ? 'briefing' : 'facts only'}</span>
          <button className="chip close" onClick={onClose} aria-label="Close">✕</button></h3>
        <h2 className="modal-title">{p.name}</h2>
        {p.address && p.address !== p.name && <p className="muted">{p.address}</p>}
        {err && <p className="err">{err}</p>}
        <div className="facts">{facts.map(([k, v]) => <div key={k}><span className="muted small">{k}</span><b>{v}</b></div>)}</div>
        {p.lat != null && (
          <p className="small"><a href={`https://www.openstreetmap.org/?mlat=${p.lat}&mlon=${p.lon}#map=18/${p.lat}/${p.lon}`} target="_blank" rel="noreferrer">
            Open on map ({p.lat.toFixed(5)}, {p.lon.toFixed(5)})</a></p>
        )}
        {p.status === 'ready'
          ? <button className="primary" onClick={() => onOpenBuilding(p.building_id)}>Open briefing</button>
          : (
            <>
              <p className="small warn">No interior plan cached for this building yet, so there's no briefing.</p>
              {p.onboard_hint && <p className="small muted">To add it: {p.onboard_hint}</p>}
            </>
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
