import { useState } from 'react'

const TABS = ['Summary', 'Hazards', 'Entry', 'Search plan', 'Sources']

export default function BriefingPanel({ b, onFocusRoom }) {
  const [tab, setTab] = useState('Summary')
  if (!b) return <div className="card"><h3>Briefing</h3><p className="muted">Loading…</p></div>
  return (
    <div className="card briefing">
      <h3>Pre-entry briefing <span className="muted small">{b.building?.name}</span></h3>
      <div className="tabs">{TABS.map((t) => <button key={t} className={t === tab ? 'on' : ''} onClick={() => setTab(t)}>{t}</button>)}</div>
      <div className="scroll">
        {tab === 'Summary' && (
          <>
            <p className="summary">{b.summary}</p>
            {b.trapped?.map((t, i) => (
              <div key={i} className="alert" onClick={() => onFocusRoom(t.room_id)}>
                <b>TRAPPED</b> {t.description} <span className="muted">· {Math.round((t.confidence || 0) * 100)}% sure</span>
                {t.candidates?.[0] && <div className="small">Likely: {t.candidates[0].label}{t.needs_assist ? ' · needs assist' : ''}</div>}
              </div>
            ))}
            {b.exit_routes?.[0] && <p className="small muted">Nearest exit for the first trapped person: {b.exit_routes[0].distance_m} m.</p>}
            <div className="caveats">{b.caveats?.map((c) => <div key={c}>⚠ {c}</div>)}</div>
          </>
        )}
        {tab === 'Hazards' && b.hazards?.map((h, i) => (
          <div key={i} className={`haz ${h.severity}`} onClick={() => h.room_id && onFocusRoom(h.room_id)}>
            <span className="sev">{h.severity}</span><span>{h.text}</span><span className="src">{h.source}</span>
          </div>
        ))}
        {tab === 'Entry' && (
          <>
            {b.entry_points?.map((e, i) => (
              <div key={i} className="row"><span className="badge">{e.side}</span><span>{e.text}</span>{e.role && <span className={`role ${e.role}`}>{e.role}</span>}</div>
            ))}
            <h4>Apparatus / ladder</h4>
            {b.ladder_positions?.map((l, i) => <div key={i} className="row"><span className="badge">{l.side}</span><span>{l.text}</span></div>)}
          </>
        )}
        {tab === 'Search plan' && b.search_plan?.map((s, i) => (
          <div key={s.room_id} className="row click" onClick={() => onFocusRoom(s.room_id)}>
            <span className="num">{i + 1}</span><span><b>{s.label}</b> <span className="muted">{s.reason}</span></span>
          </div>
        ))}
        {tab === 'Sources' && (
          <>
            {b.trace?.map((t, i) => <div key={i} className="row"><span className="badge">{t.step}</span><span>{t.text}</span></div>)}
            {b.occupancy && <p className="small muted">Occupancy: ~{b.occupancy.employees_estimate} on floor {b.occupancy.floor}; tenants: {b.occupancy.tenant_names?.join(', ')}</p>}
          </>
        )}
      </div>
    </div>
  )
}
