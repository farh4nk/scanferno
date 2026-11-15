import { useEffect, useState } from 'react'
import { asset, getAerialNotes } from '../api'
import { SIDE_NAME } from './model'

// Aerial photo with the fireground drawn on it: each visible wall tagged with its side letter,
// the fire side in red, where the search crew goes in, aerial staging, entrances and roof features.
// Positions come from `vexcel/annotations.json` next to the images (hand-placed per building);
// without that file the photo shows plain.

const COMPASS = ['N', 'E', 'S', 'W']
const PHON = { A: 'Alpha', B: 'Bravo', C: 'Charlie', D: 'Delta' }
export const sideOfCompass = (front, c) => 'ABCD'[(COMPASS.indexOf(c) - COMPASS.indexOf(front || 'S') + 4) % 4]
// Vexcel names an oblique by the way the camera looks, so it shows the opposite wall
const OPP = { N: 'S', S: 'N', E: 'W', W: 'E' }
export const viewOfCompass = (c) => `oblique-${{ N: 'north', S: 'south', E: 'east', W: 'west' }[OPP[c]]}`
export const viewLabel = (v, front) => {
  if (v === 'nadir') return 'Top-down'
  const c = OPP[v.replace('oblique-', '')[0].toUpperCase()]
  const s = sideOfCompass(front, c)
  return `${s} · ${SIDE_NAME[s]}`
}

const notesCache = new Map()
export function useAerialNotes(imageUrl) {
  const dir = imageUrl ? imageUrl.replace(/\/[^/]+$/, '') : null
  const [notes, setNotes] = useState(() => (dir ? notesCache.get(dir) ?? null : null))
  useEffect(() => {
    if (!dir) return undefined
    if (notesCache.has(dir)) { setNotes(notesCache.get(dir)); return undefined }
    let alive = true
    getAerialNotes(dir).then((n) => { notesCache.set(dir, n); if (alive) setNotes(n) }).catch(() => { notesCache.set(dir, null); if (alive) setNotes(null) })
    return () => { alive = false }
  }, [dir])
  return notes
}

const mid = (pts) => [pts.reduce((a, p) => a + p[0], 0) / pts.length, pts.reduce((a, p) => a + p[1], 0) / pts.length]

export default function AerialView({ view, src, k, compact = false }) {
  const notes = useAerialNotes(src)
  const v = notes?.views?.[view]
  if (!v) return <img className="aer" src={asset(src)} alt={`Aerial ${view}`} />
  const [W, H] = v.size
  const front = k?.bld?.front || 'S'
  const fireSide = k?.fireKnown ? k.side : null
  const searchSide = k?.search?.side
  const ladders = k?.ladders || []
  const u = (W / 1000) * (compact ? 1.7 : 1) // label scale: same visual size on every photo, larger when the photo is small
  return (
    <svg className={`aer aerial ${compact ? 'compact' : ''}`} viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid meet" role="img" aria-label={`Aerial ${view} with building sides marked`}>
      <defs>
        <pattern id="aer-hatch" width={14 * u} height={14 * u} patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
          <rect width={14 * u} height={14 * u} fill="rgba(212,42,30,.32)" /><line x1="0" y1="0" x2="0" y2={14 * u} stroke="rgba(255,90,31,.7)" strokeWidth={5 * u} />
        </pattern>
      </defs>
      <image href={asset(src)} width={W} height={H} />
      <rect width={W} height={H} fill="rgba(16,12,11,.28)" />
      {v.faces.map((f) => {
        const s = sideOfCompass(front, f.compass)
        const fire = s === fireSide
        const pts = f.poly || f.edge
        const [cx, cy] = f.label || mid(pts)
        const tags = [fire && 'FIRE SIDE', !compact && s === searchSide && 'SEARCH IN', s === 'A' && !fire && 'FRONT'].filter(Boolean)
        return (
          <g key={f.compass} className={`face ${fire ? 'fire' : ''}`}>
            {f.poly
              ? <polygon points={f.poly.map((p) => p.join(',')).join(' ')} fill={fire ? 'url(#aer-hatch)' : 'rgba(255,90,31,.10)'} stroke={fire ? 'var(--red)' : 'var(--fire)'} strokeWidth={4 * u} strokeLinejoin="round" />
              : <line x1={f.edge[0][0]} y1={f.edge[0][1]} x2={f.edge[1][0]} y2={f.edge[1][1]} stroke={fire ? 'var(--red)' : 'var(--fire)'} strokeWidth={(fire ? 12 : 6) * u} strokeLinecap="round" />}
            <g transform={`translate(${cx},${cy})`}>
              <circle r={30 * u} fill={fire ? 'var(--red)' : 'var(--fire)'} stroke="var(--night)" strokeWidth={4 * u} />
              <text className="letter" y={11 * u} fontSize={32 * u}>{s}</text>
              {!compact && !f.minor && <text className="sidename" y={58 * u} fontSize={21 * u}>{PHON[s].toUpperCase()}{tags.length ? ` · ${tags.join(' · ')}` : ''}</text>}
              {compact && !f.minor && tags.length > 0 && <text className="sidename" y={58 * u} fontSize={26 * u}>{tags[0]}</text>}
            </g>
            {f.staging && ladders.includes(s) && (
              <g transform={`translate(${f.staging[0]},${f.staging[1]})`} className="staging">
                <rect x={-26 * u} y={-26 * u} width={52 * u} height={52 * u} rx={6 * u} fill="var(--white)" stroke="var(--night)" strokeWidth={4 * u} />
                {/* ladder glyph */}
                <path d={`M${-9 * u},${16 * u}L${-9 * u},${-16 * u}M${9 * u},${16 * u}L${9 * u},${-16 * u}M${-9 * u},${-8 * u}H${9 * u}M${-9 * u},0H${9 * u}M${-9 * u},${8 * u}H${9 * u}`} stroke="var(--ink)" strokeWidth={4 * u} fill="none" />
                {!compact && <text className="pill-t" x={36 * u} y={8 * u} fontSize={21 * u}>AERIAL STAGING</text>}
              </g>
            )}
          </g>
        )
      })}
      {!compact && v.marks.map((m, i) => (
        <g key={i} transform={`translate(${m.at[0]},${m.at[1]})`} className={`mark ${m.kind}`}>
          <circle r={10 * u} strokeWidth={4 * u} />
          <text x={18 * u} y={7 * u} fontSize={19 * u}>{m.text}</text>
        </g>
      ))}
    </svg>
  )
}
