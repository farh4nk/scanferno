const CONF = ['address', 'floor', 'side', 'trapped', 'hazards']

function Field({ label, value, changed, conf, n }) {
  const empty = value == null || value === '' || (Array.isArray(value) && value.length === 0)
  return (
    <div className={`field ${changed ? 'changed' : ''}`} key={changed ? n : 0}>
      <span className="k">{label}</span>
      <span className={empty ? 'v muted' : 'v'}>{empty ? '–' : Array.isArray(value) ? value.join(', ') : String(value)}</span>
      {conf != null && !empty && <span className="conf" title={`confidence ${Math.round(conf * 100)}%`}><i style={{ width: `${conf * 100}%` }} /></span>}
    </div>
  )
}

export default function DispatchPanel({ record, n }) {
  const r = record
  const ch = new Set(r?.changed || [])
  const c = r?.confidence || {}
  return (
    <div className="card">
      <h3>Dispatch record <span className="muted small">{r ? `update #${n}` : 'waiting for call'}</span></h3>
      <div className="fields">
        <Field label="Address" value={r?.address} changed={ch.has('address')} conf={c.address} n={n} />
        <Field label="Floor" value={r?.floor} changed={ch.has('floor')} conf={c.floor} n={n} />
        <Field label="Side" value={r?.side} changed={ch.has('side')} conf={c.side} n={n} />
        <Field label="Fire location" value={r?.fire_location} changed={ch.has('fire_location')} n={n} />
        <Field label="Conditions" value={r?.conditions} changed={ch.has('conditions')} n={n} />
        <Field label="Hazards" value={r?.hazards} changed={ch.has('hazards')} conf={c.hazards} n={n} />
        <Field label="Caller at" value={r?.caller_location} changed={ch.has('caller_location')} n={n} />
        <Field label="Cross street" value={r?.cross_street} changed={ch.has('cross_street')} n={n} />
      </div>
      {r?.trapped?.length > 0 && (
        <div className={`trapped ${ch.has('trapped') ? 'changed' : ''}`} key={`t${n}`}>
          <b>Trapped</b>
          {r.trapped.map((t, i) => (
            <div key={i} className="t-item">
              <span>{t.description}</span>
              <span className="muted small">
                {t.location ? ` · ${t.location}` : ''}{t.floor ? ` · floor ${t.floor}` : ''}
                {t.room_candidates?.[0] ? ` → ${t.room_candidates[0].label} (${Math.round(t.room_candidates[0].confidence * 100)}%)` : ''}
              </span>
            </div>
          ))}
        </div>
      )}
      {r && <p className="muted small">Extractor: {r.extractor} · fields: {CONF.filter((k) => c[k] != null).map((k) => `${k} ${Math.round(c[k] * 100)}%`).join(', ')}</p>}
    </div>
  )
}
