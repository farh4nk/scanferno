import { useMemo, useState } from 'react'

// Plan coordinates are meters with y up; SVG has y down, so every point goes through P().
const P = ([x, y]) => [x, -y]
const pts = (poly) => poly.map((p) => P(p).join(',')).join(' ')

function heat(v) {
  // 0 (safe) green -> 0.5 amber -> 1 (worst) red
  const h = 130 - 130 * Math.min(1, Math.max(0, v))
  return `hsl(${h} 70% 38%)`
}

const SIDE_POS = { N: [0, -1], S: [0, 1], E: [1, 0], W: [-1, 0] }

export default function FloorPlan({
  plan, layers, searchOrder, trapped, fireRooms, selected, onSelect,
  highlight, mayday, evacFrame, sides, previewRoute,
}) {
  const [hover, setHover] = useState(null)

  const bbox = useMemo(() => {
    const all = plan.rooms.flatMap((r) => r.polygon).concat(plan.outline || [])
    const xs = all.map((p) => p[0]); const ys = all.map((p) => -p[1])
    const pad = 3
    return { x0: Math.min(...xs) - pad, y0: Math.min(...ys) - pad, x1: Math.max(...xs) + pad, y1: Math.max(...ys) + pad }
  }, [plan])
  const w = bbox.x1 - bbox.x0; const h = bbox.y1 - bbox.y0

  const roomById = useMemo(() => Object.fromEntries(plan.rooms.map((r) => [r.id, r])), [plan])
  const hiRooms = new Set(highlight?.rooms || [])
  const hiDoors = new Set(highlight?.doors || [])
  const fire = new Set(fireRooms || [])
  const info = roomById[hover || selected]
  const detail = info && plan.maze_detail?.[info.id]

  const fill = (r) => {
    if (layers.heat && plan.maze_score?.[r.id] != null) return heat(plan.maze_score[r.id])
    if (r.type === 'hallway') return '#2a3140'
    return '#1d2330'
  }

  const routePoly = previewRoute || (selected && plan.exit_routes?.[selected]?.polyline)
  const fs = Math.max(0.55, w / 55) // label size scales with the plan

  return (
    <div className="plan">
      <svg viewBox={`${bbox.x0} ${bbox.y0} ${w} ${h}`} preserveAspectRatio="xMidYMid meet">
        <defs>
          <pattern id="hatch" width="0.6" height="0.6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
            <rect width="0.6" height="0.6" fill="rgba(255,90,20,.18)" />
            <line x1="0" y1="0" x2="0" y2="0.6" stroke="rgba(255,140,40,.8)" strokeWidth="0.18" />
          </pattern>
          <marker id="arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse">
            <path d="M0 0L10 5L0 10z" fill="#4dd0ff" />
          </marker>
        </defs>

        {/* rooms */}
        {plan.rooms.map((r) => (
          <g key={r.id} onClick={() => onSelect(r.id === selected ? null : r.id)}
             onMouseEnter={() => setHover(r.id)} onMouseLeave={() => setHover(null)} style={{ cursor: 'pointer' }}>
            <polygon points={pts(r.polygon)} fill={fill(r)}
              stroke={r.id === selected ? '#fff' : hiRooms.has(r.id) ? '#4dd0ff' : '#0b0e14'}
              strokeWidth={r.id === selected || hiRooms.has(r.id) ? 0.28 : 0.12} />
            {fire.has(r.id) && <polygon points={pts(r.polygon)} fill="url(#hatch)" stroke="#ff7a1a" strokeWidth="0.25" pointerEvents="none" />}
            {hiRooms.has(r.id) && <polygon points={pts(r.polygon)} fill="rgba(77,208,255,.2)" pointerEvents="none" />}
          </g>
        ))}

        {/* labels */}
        {plan.rooms.map((r) => {
          const [cx, cy] = P(r.centroid)
          const n = layers.order ? searchOrder[r.id] : null
          return (
            <g key={`l-${r.id}`} pointerEvents="none">
              <text x={cx} y={cy + (n ? fs * 1.55 : 0.3 * fs)} textAnchor="middle" fontSize={fs * 0.82} fill="#c9d1e0" opacity=".85">
                {r.label}
              </text>
              {n && (
                <g>
                  <circle cx={cx} cy={cy - fs * 0.2} r={fs * 0.85} fill="#ffb02e" />
                  <text x={cx} y={cy - fs * 0.2 + fs * 0.33} textAnchor="middle" fontSize={fs * 1.05} fontWeight="700" fill="#111">{n}</text>
                </g>
              )}
            </g>
          )
        })}

        {/* windows */}
        {layers.windows && plan.windows.map((wi) => {
          const [x, y] = P(wi.position)
          return <rect key={wi.id} x={x - 0.35} y={y - 0.35} width="0.7" height="0.7" fill="#7fb8ff" opacity=".8" transform={`rotate(45 ${x} ${y})`} />
        })}

        {/* doors */}
        {layers.doors && plan.doors.map((d) => {
          const [x, y] = P(d.position)
          const hi = hiDoors.has(d.id)
          return (
            <g key={d.id}>
              <circle cx={x} cy={y} r={d.is_exit ? 0.75 : 0.42} fill={d.is_exit ? '#2ecc71' : '#e8ecf5'}
                stroke={hi ? '#4dd0ff' : '#0b0e14'} strokeWidth={hi ? 0.3 : 0.1} />
              {d.is_exit && <text x={x} y={y - 1.0} textAnchor="middle" fontSize={fs * 0.85} fill="#2ecc71" fontWeight="700">EXIT {d.side || ''}</text>}
              <title>{`${d.id} · ${d.width_m} m${d.is_exit ? ' · exit' : ''}`}</title>
            </g>
          )
        })}

        {/* exit route for selected room / Q&A highlight / briefing trapped routes */}
        {routePoly && <polyline points={pts(routePoly)} fill="none" stroke="#4dd0ff" strokeWidth="0.4" strokeDasharray="0.9 0.5" markerEnd="url(#arrow)" />}
        {layers.routes && trapped.map((t) => {
          const route = plan.exit_routes?.[t.room_id]?.polyline
          return route ? <polyline key={`tr-${t.room_id}`} points={pts(route)} fill="none" stroke="#4dd0ff" strokeWidth="0.45" strokeDasharray="0.9 0.5" markerEnd="url(#arrow)" /> : null
        })}
        {(highlight?.polylines || []).map((pl, i) => (
          <polyline key={`hp-${i}`} points={pts(pl)} fill="none" stroke="#ffe14d" strokeWidth="0.5" markerEnd="url(#arrow)" />
        ))}

        {/* mayday wall-following path */}
        {mayday?.wall_path && (
          <g pointerEvents="none">
            <polyline points={pts(mayday.wall_path)} fill="none" stroke="#ff3b6b" strokeWidth="0.5" strokeLinejoin="round" />
            <circle cx={P(mayday.wall_path[0])[0]} cy={P(mayday.wall_path[0])[1]} r="0.8" fill="#ff3b6b" />
          </g>
        )}

        {/* trapped markers */}
        {trapped.map((t) => {
          const r = roomById[t.room_id]
          if (!r) return null
          const [cx, cy] = P(r.centroid)
          return (
            <g key={`t-${t.room_id}`} pointerEvents="none">
              <circle cx={cx} cy={cy} r="1" fill="none" stroke="#ff2a2a" strokeWidth="0.25" className="pulse" />
              <circle cx={cx} cy={cy} r="0.7" fill="#ff2a2a" />
              <text x={cx} y={cy + 0.27} textAnchor="middle" fontSize="0.8" fontWeight="800" fill="#fff">!</text>
            </g>
          )
        })}

        {/* evac agents */}
        {evacFrame?.agents?.map((a, i) => {
          const [x, y] = P(a)
          return <circle key={i} cx={x} cy={y} r="0.38" fill="#ffe14d" stroke="#000" strokeWidth="0.06" />
        })}

        {/* fireground sides */}
        {sides && Object.entries(sides).map(([k, s]) => {
          const d = SIDE_POS[s.compass]
          if (!d) return null
          const x = d[0] ? (d[0] > 0 ? bbox.x1 - 1.2 : bbox.x0 + 1.2) : (bbox.x0 + bbox.x1) / 2
          const y = d[1] ? (d[1] > 0 ? bbox.y1 - 0.9 : bbox.y0 + 1.6) : (bbox.y0 + bbox.y1) / 2
          return <text key={k} x={x} y={y} textAnchor="middle" fontSize={fs * 1.8} fontWeight="800" fill="#ff7a1a" opacity=".75">{k}</text>
        })}
      </svg>

      {info && (
        <div className="plan-tip">
          <b>{info.label}</b> <span className="muted">{info.type}{info.type_inferred ? ' (inferred)' : ''} · {info.area_m2} m² · side {info.side || '–'}</span>
          {plan.maze_score?.[info.id] != null && (
            <div>Maze score <b style={{ color: heat(plan.maze_score[info.id]) }}>{plan.maze_score[info.id].toFixed(2)}</b></div>
          )}
          {detail?.why?.length > 0 && <ul>{detail.why.map((x) => <li key={x}>{x}</li>)}</ul>}
        </div>
      )}
    </div>
  )
}
