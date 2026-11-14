import { useMemo } from 'react'
import { makeView } from './model'

const ZONE_FILL = {
  untenable: 'rgba(180, 24, 18, 0.55)',
  high: 'rgba(255, 90, 31, 0.42)',
  caution: 'rgba(255, 176, 46, 0.28)',
  clear: undefined,
}

// One floor-plan renderer for every screen. Overlays are passed in as plain data so each page
// draws only what its job needs (plan of attack, search order, mayday path, evac dots, ...).
export default function PlanSvg({
  plan, k, selected, onSelect, heat = false, danger = true, order = null, routes = [], walked = null,
  dashed = null, hose = null, tags = [], victim = true, fire = true, doors = true, bigExits = false,
  hiDoors = [], agents = null, dim = false, deadEnd = null, sides = true, pulse = null,
  people = null, rescueRoutes = null,
}) {
  const v = useMemo(() => makeView(plan), [plan])
  const fireSet = new Set(fire ? k?.fireIds || [] : [])
  const vid = victim ? k?.victim : null
  const heatRooms = danger ? k?.heatRooms : null
  const peopleMarks = people ?? (k?.rescuePeople || []).map((p) => ({ id: p.id, at: p.position, label: p.description }))
  const taggedRoutes = rescueRoutes || null
  const tag = ([x, y], text, cls, i) => {
    const w = text.length * 10.5 + 28
    const cx = Math.min(Math.max(x, w / 2 + 6), v.W - w / 2 - 6)
    return (
      <g key={`t${i}`} className={`tag ${cls || ''}`} transform={`translate(${cx},${y})`}>
        <rect x={-w / 2} y={-17} width={w} height={34} rx={6} /><text dy={6}>{text}</text>
      </g>
    )
  }
  return (
    <svg className="plan" viewBox={`0 0 ${v.W.toFixed(0)} ${v.H.toFixed(0)}`} role="img" aria-label="Floor plan">
      <defs>
        <pattern id="hatch" width="14" height="14" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
          <rect width="14" height="14" fill="#3a130e" /><line x1="0" y1="0" x2="0" y2="14" stroke="#d42a1e" strokeWidth="5" />
        </pattern>
      </defs>
      {plan.rooms.map((r) => {
        const zone = heatRooms?.[r.id]?.zone
        const cls = ['rm', dim && 'dim', fireSet.has(r.id) && 'hf', r.id === vid && 'victim',
          r.id === selected && 'sel', r.id === deadEnd && 'de', onSelect && 'click'].filter(Boolean).join(' ')
        let style
        if (heat && !fireSet.has(r.id) && r.id !== vid) style = { fill: `rgba(255,90,31,${(plan.maze_score?.[r.id] || 0) * 0.75})` }
        else if (zone && ZONE_FILL[zone] && !fireSet.has(r.id)) style = { fill: ZONE_FILL[zone] }
        return <polygon key={r.id} className={cls} style={style} points={v.str(r.polygon)} onClick={onSelect ? () => onSelect(r.id) : undefined}><title>{r.label}{zone ? ` · ${zone}` : ''}</title></polygon>
      })}
      {hose && <polyline className="hoseln" points={v.str(hose)} />}
      {taggedRoutes
        ? taggedRoutes.map((r, i) => r?.polyline?.length > 1 && <polyline key={`rr${i}`} className={`route ${r.cls || ''}`} points={v.str(r.polyline)} />)
        : routes.map((pl, i) => <polyline key={`r${i}`} className={`route ${i > 0 && routes.length > 2 ? 'thin' : ''}`} points={v.str(pl)} />)}
      {dashed && <polyline className="route go" points={v.str(dashed)} />}
      {walked && <polyline className="route done" points={v.str(walked)} />}
      {doors && plan.doors.filter((d) => d.is_exit || hiDoors.includes(d.id)).map((d) => {
        const [x, y] = v.p(d.position); const s = bigExits ? 13 : 9
        return <rect key={d.id} className={`ex ${hiDoors.includes(d.id) ? 'hi' : ''}`} x={x - s} y={y - s} width={2 * s} height={2 * s} />
      })}
      {plan.rooms.map((r) => {
        const [x, y] = v.p(r.centroid)
        if (order?.[r.id]) return <g key={`o${r.id}`} className="ord" transform={`translate(${x},${y})`}><circle r={19} /><text dy={7}>{order[r.id]}</text></g>
        return <text key={`l${r.id}`} className="lbl" x={x} y={y + 5}>{r.label.replace(/^(Office|Hallway|Kitchen|Room) /, '')}</text>
      })}
      {peopleMarks.map((p, i) => {
        if (!p?.at) return null
        const [x, y] = v.p(p.at)
        return (
          <g key={p.id || `p${i}`} className="person" transform={`translate(${x},${y})`}>
            <circle className="person-ring" r={16} /><circle className="person-dot" r={8} />
            {p.label && <text className="person-lbl" y={-22}>{(p.label || '').split(' ')[0]}</text>}
          </g>
        )
      })}
      {pulse && (() => { const [x, y] = v.p(pulse); return <g><circle className="pulse" cx={x} cy={y} r={26} /><circle className="vdot" cx={x} cy={y} r={14} /></g> })()}
      {agents?.map((a, i) => a && <circle key={`a${i}`} className="ag" cx={v.p(a)[0]} cy={v.p(a)[1]} r={7} />)}
      {tags.map((t, i) => tag(t.at === 'top' ? [v.W / 2, 40] : t.at === 'bottom' ? [v.W / 2, v.H - 30] : v.p(t.at).map((n, j) => n + (j ? t.dy || 0 : t.dx || 0)), t.text, t.cls, i))}
      {sides && <>
        <text className="sidel" x={v.W / 2} y={v.H - 8}>A</text><text className="sidel" x={v.W / 2} y={26}>C</text>
        <text className="sidel" x={16} y={v.H / 2}>B</text><text className="sidel" x={v.W - 16} y={v.H / 2}>D</text>
      </>}
    </svg>
  )
}
