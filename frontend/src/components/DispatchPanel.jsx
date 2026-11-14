const CONF = ['address', 'floor', 'side', 'trapped', 'hazards']
const FIELDS = [
  ['address', 'Address', true], ['floor', 'Floor', true], ['side', 'Side', true], ['fire_location', 'Fire location'],
  ['conditions', 'Conditions'], ['hazards', 'Hazards', true], ['caller_location', 'Caller at'], ['cross_street', 'Cross street'],
]

const show = (v) => (Array.isArray(v) ? v.join(', ') : String(v))

function Field({ label, value, changed, conf, was, n }) {
  const empty = value == null || value === '' || (Array.isArray(value) && value.length === 0)
  return (
    <div className={`field ${changed ? 'changed' : ''}`} key={changed ? n : 0}>
      <span className="k">{label}</span>
      <span className={empty ? 'v muted' : 'v'}>
        {was != null && <s className="was" title="caller corrected this">{show(was)}</s>}
        {empty ? '–' : show(value)}
      </span>
      {conf != null && !empty && <span className="conf" title={`confidence ${Math.round(conf * 100)}%`}><i style={{ width: `${conf * 100}%` }} /></span>}
    </div>
  )
}

export default function DispatchPanel({ record, n }) {
  const r = record
  const ch = new Set(r?.changed || [])
  const c = r?.confidence || {}
  const corr = r?.corrections || {}
  const was = (k) => corr[k]?.[corr[k].length - 1]?.from
  return (
    <div className="card">
      <h3>Dispatch record <span className="muted small">{r ? `update #${n}` : 'waiting for call'}</span></h3>
      <div className="fields">
        {FIELDS.map(([k, label, hasConf]) => (
          <Field key={k} label={label} value={r?.[k]} changed={ch.has(k)} conf={hasConf ? c[k] : null} was={was(k)} n={n} />
        ))}
      </div>
      {r?.trapped?.length > 0 && (
        <div className={`trapped ${ch.has('trapped') ? 'changed' : ''}`} key={`t${n}`}>
          <b>Trapped</b>
          {was('trapped') && <span className="small muted"> · caller corrected: <s className="was">{show(was('trapped'))}</s></span>}
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
