import { useMemo } from 'react'
import { makeView } from './model'

function fitLabel(label, polygon, v) {
  const compact = label.replace(/^(Office|Hallway|Kitchen|Room) /, '').replace(/^(Restroom|Bathroom) /, 'RR ')
  const pts = polygon.map(v.p)
  const width = Math.max(...pts.map(([x]) => x)) - Math.min(...pts.map(([x]) => x))
  const height = Math.max(...pts.map(([, y]) => y)) - Math.min(...pts.map(([, y]) => y))
  const maxChars = Math.max(2, Math.floor((width - 10) / 8))
  const lines = []
  for (const word of compact.split(/\s+/)) {
    const last = lines.length - 1
    if (last >= 0 && `${lines[last]} ${word}`.length <= maxChars) lines[last] += ` ${word}`
    else if (lines.length < 2) lines.push(word)
    else lines[1] = `${lines[1].slice(0, Math.max(1, maxChars - 1))}…`
  }
  const longest = Math.max(...lines.map((line) => line.length))
  const fontSize = Math.max(8, Math.min(15, (width - 10) / (longest * 0.58), (height - 8) / (lines.length * 1.15)))
  return { lines: lines.map((line) => line.length > maxChars ? `${line.slice(0, Math.max(1, maxChars - 1))}…` : line), fontSize }
}

// One floor-plan renderer for every screen. Overlays are passed in as plain data so each page
// draws only what its job needs (plan of attack, search order, mayday path, evac dots, ...).
export default function PlanSvg({
  plan, k, selected, onSelect, heat = false, danger = true, order = null, routes = [], walked = null,
  dashed = null, hose = null, tags = [], victim = true, fire = true, doors = true, bigExits = false,
  hiDoors = [], agents = null, dim = false, deadEnd = null, sides = true, pulse = null, flash = [],
  people = null, rescueRoutes = null, checked = null, selectedPersonId = null, onPersonSelect = null,
}) {
  const v = useMemo(() => makeView(plan), [plan])
  const fireSet = new Set(fire ? k?.fireIds || [] : [])
  const vid = victim ? k?.victim : null
  const heatRooms = danger ? k?.heatRooms : null
  const peopleMarks = people ?? (
    k?.rescuePeople?.length
      ? k.rescuePeople.map((p) => ({ id: p.id, at: p.position || k.R[p.room_id]?.centroid, label: p.description }))
      : (k?.trapped || []).map((p, i) => ({ id: p.description || `person-${i}`, at: k.R[p.room_id]?.centroid, label: p.description }))
  )
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
        const dangerValue = heatRooms?.[r.id]?.danger ?? 0
        const cls = ['rm', dim && 'dim', fireSet.has(r.id) && 'hf', r.id === vid && 'victim',
          r.id === selected && 'sel', checked?.has(r.id) && 'chk', r.id === deadEnd && 'de', flash.includes(r.id) && 'flash', onSelect && 'click'].filter(Boolean).join(' ')
        let style
        if (heat && !fireSet.has(r.id) && r.id !== vid) style = { fill: `rgba(255,90,31,${(plan.maze_score?.[r.id] || 0) * 0.75})` }
        else if (danger && dangerValue >= 0.12 && !fireSet.has(r.id) && r.id !== vid) {
          const color = dangerValue >= 0.75 ? '212,42,30' : '255,125,31'
          style = { fill: `rgba(${color},${(0.12 + dangerValue * 0.45).toFixed(2)})` }
        }
        return <polygon key={r.id} className={cls} style={style} points={v.str(r.polygon)} onClick={onSelect ? () => onSelect(r.id) : undefined}>
          <title>{r.label}{zone ? ` · ${zone}` : ''}{heatRooms?.[r.id] ? ` · modeled danger ${Math.round(dangerValue * 100)}%` : ''}</title>
        </polygon>
      })}
      {hose && <polyline className="hoseln" points={v.str(hose)} />}
      {taggedRoutes
        ? taggedRoutes.map((r, i) => r?.polyline?.length > 1 && <polyline key={`rr${i}`} className={`route ${r.cls || ''}`} points={v.str(r.polyline)} />)
        : routes.map((pl, i) => <polyline key={`r${i}`} className={`route ${i > 0 && routes.length > 2 ? 'thin' : ''}`} points={v.str(pl)} />)}
      {taggedRoutes?.map((r, i) => {
        if (!r?.polyline?.length) return null
        const point = r.startLabel ? r.polyline?.[0] : r.endLabel ? r.polyline?.[r.polyline.length - 1] : null
        const text = r.startLabel || r.endLabel
        if (!point || !text) return null
        const [x, y] = v.p(point)
        return <g key={`rt${i}`} className={`route-terminal ${r.cls || ''}`} transform={`translate(${x},${y})`}>
          <circle r={8} /><text x={12} y={-10}>{text}</text>
        </g>
      })}
      {dashed && <polyline className="route go" points={v.str(dashed)} />}
      {walked && <polyline className="route done" points={v.str(walked)} />}
      {doors && plan.doors.filter((d) => d.is_exit || hiDoors.includes(d.id)).map((d) => {
        const [x, y] = v.p(d.position); const s = bigExits ? 13 : 9
        return <rect key={d.id} className={`ex ${hiDoors.includes(d.id) ? 'hi' : ''}`} x={x - s} y={y - s} width={2 * s} height={2 * s} />
      })}
      {plan.rooms.map((r) => {
        const [x, y] = v.p(r.centroid)
        if (checked?.has(r.id)) return <g key={`o${r.id}`} className="ord chk" transform={`translate(${x},${y})`}><circle r={19} /><text dy={7}>✓</text></g>
        if (order?.[r.id]) return <g key={`o${r.id}`} className="ord" transform={`translate(${x},${y})`}><circle r={19} /><text dy={7}>{order[r.id]}</text></g>
        const { lines, fontSize } = fitLabel(r.label, r.polygon, v)
        const firstY = y + 5 - ((lines.length - 1) * fontSize * 0.55)
        return <text key={`l${r.id}`} className="lbl" style={{ fontSize }} aria-label={r.label}>
          <title>{r.label}</title>
          {lines.map((line, i) => <tspan key={i} x={x} y={firstY + i * fontSize * 1.1}>{line}</tspan>)}
        </text>
      })}
      {peopleMarks.map((p, i) => {
        if (!p?.at) return null
        const [x, y] = v.p(p.at)
        return (
          <g key={p.id || `p${i}`} className={`person ${p.id === selectedPersonId ? 'selected' : ''} ${p.located === false ? 'unknown' : ''} ${onPersonSelect && p.id ? 'selectable' : ''}`}
            transform={`translate(${x},${y})`}
            role={onPersonSelect && p.id ? 'button' : undefined}
            tabIndex={onPersonSelect && p.id ? 0 : undefined}
            aria-label={onPersonSelect && p.id ? `Show route for ${p.label || 'person'}` : undefined}
            onClick={onPersonSelect && p.id ? (e) => { e.stopPropagation(); onPersonSelect(p.id) } : undefined}
            onKeyDown={onPersonSelect && p.id ? (e) => {
              if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); onPersonSelect(p.id) }
            } : undefined}>
            <circle className="person-ring" r={16} /><circle className="person-dot" r={8} />
            {p.label && p.id === selectedPersonId && <text className="person-lbl" y={-22}>{(p.label || '').split(' ')[0]}</text>}
            <title>{p.label || 'Person'}{p.located === false ? ' · location unknown' : p.id === selectedPersonId ? ' · selected' : ''}</title>
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
