// Small data diagrams for the briefing: each replaces a paragraph of text with a picture.

const Svg = ({ w, h, wide, children, label }) => (
  <svg className={`dg ${wide ? 'wide' : ''}`} viewBox={`0 0 ${w} ${h}`} width={wide ? undefined : w} height={wide ? undefined : h} role="img" aria-label={label}>{children}</svg>
)

// ---------- pictograms for the key-fact band (64 x 64) ----------
export function FirePict({ stories = 5, floor, side, known }) {
  const n = Math.min(Math.max(stories || 1, 1), 6); const fh = 52 / n
  return (
    <Svg w={64} h={64} label="Fire floor">
      {Array.from({ length: n }, (_, i) => {
        const f = n - i
        return <rect key={f} x="10" y={6 + i * fh} width="32" height={fh - 2} rx="1.5" className={known && f === floor ? 'pf' : 'pb'} />
      })}
      <rect x="4" y="60" width="46" height="2" className="pg" />
      <text x="56" y="58" className="pt">{known && side ? side : '?'}</text>
    </Svg>
  )
}
export const WatchPict = ({ known, o2 }) => (
  <Svg w={64} h={64} label="Hazard">
    {!known ? <><circle cx="32" cy="32" r="20" className="pq" /><text x="32" y="40" className="ptc dim">?</text></>
      : o2 ? <><rect x="22" y="14" width="20" height="44" rx="9" className="pcyl" /><rect x="27" y="6" width="10" height="9" rx="2" className="pcyl" /><text x="32" y="42" className="ptc">O₂</text></>
        : <><path d="M32 8l26 46H6z" className="pcyl" /><text x="32" y="47" className="ptc">!</text></>}
  </Svg>
)
export const EnterPict = ({ side = 'A' }) => (
  <Svg w={64} h={64} label="Entry door">
    <rect x="8" y="8" width="48" height="36" rx="3" className="pfoot" /><rect x="18" y="41" width="10" height="6" className="pdoor" />
    <path d="M23 62V50M18 55l5-5 5 5" className="parr" /><text x="46" y="60" className="pt">{side}</text>
  </Svg>
)
export const TrappedPict = ({ known }) => (
  <Svg w={64} h={64} label="Trapped person">
    {known ? <><rect x="6" y="6" width="52" height="52" rx="6" className="pvroom" /><circle cx="32" cy="24" r="7" className="pperson" /><path d="M19 50c0-9 6-14 13-14s13 5 13 14" className="pperson" /></>
      : <><rect x="6" y="6" width="52" height="52" rx="6" className="pq" /><text x="32" y="41" className="ptc dim">?</text></>}
  </Svg>
)
export const ExitPict = () => (
  <Svg w={64} h={64} label="Exit"><rect x="36" y="8" width="20" height="48" rx="2" className="pexit" /><path d="M8 32h24M24 24l8 8-8 8" className="parr" /></Svg>
)

// ---------- building cross-section: floors, fire floor, people, roof height ----------
export function Section({ k }) {
  const n = Math.min(Math.max(k.stories || 1, 1), 8); const fh = Math.min(36, 180 / n)
  const W = 400; const x0 = 40; const bw = 200; const base = 30 + n * fh; const top = base - n * fh; const rx = x0 + bw + 30
  const people = k.fireKnown ? Math.min(k.people || 0, 9) : 0
  return (
    <Svg w={W} h={base + 32} wide label="Building section">
      <line x1="20" y1={base} x2={W - 20} y2={base} className="sg" />
      {Array.from({ length: n }, (_, i) => {
        const f = i + 1; const y = base - f * fh; const hot = k.fireKnown && f === k.floor
        return (
          <g key={f}>
            <rect x={x0} y={y} width={bw} height={fh - 4} rx="2" className={hot ? 'sfire' : 'sfl'} />
            <text x={x0 - 14} y={y + fh / 2 + 3} className="slab">{f}</text>
            {f === k.floor && Array.from({ length: people }, (_, j) => (
              <g key={j}><circle cx={x0 + 16 + j * 11} cy={y + 10} r="3.4" className="sppl" /><rect x={x0 + 12.5 + j * 11} y={y + 15} width="7" height="9" rx="3" className="sppl" /></g>
            ))}
            {f === k.floor && people ? <text x={x0 + bw - 10} y={y + fh / 2 + 3} className="sfx">{k.people} people</text> : null}
          </g>
        )
      })}
      <text x={x0} y={base + 22} className="sside">A front</text>
      <text x={x0 + bw} y={base + 22} textAnchor="end" className={`sside ${k.fireKnown ? 'hot' : ''}`}>C rear{k.fireKnown && k.side === 'C' ? ' · fire' : ''}</text>
      {k.roof ? <>
        <line x1={rx} y1={top} x2={rx} y2={base} className="srule" /><line x1={rx - 6} y1={top} x2={rx + 6} y2={top} className="srule" />
        <text x={rx + 10} y={top + 5} className="sfx l">{Math.round(k.roof)} m roof</text>
        {k.ladders.length ? <><text x={rx + 10} y={top + 24} className="slab l">aerial device</text><text x={rx + 10} y={top + 40} className="slab l">on {k.ladders.join(' and ')}</text></> : null}
      </> : null}
      {k.bld.sprinklers ? <g transform={`translate(${x0 + 6},${top - 14})`}><path d="M0 8h40M8 8v-6M32 8v-6" className="srule" /><text x="48" y="10" className="slab l">sprinklered</text></g> : null}
    </Svg>
  )
}

// ---------- hose gauge against a 200 ft preconnect ----------
export function HoseGauge({ ft, len = 200 }) {
  const x0 = 16; const w = 360; const fx = x0 + w * Math.min(ft, len) / len
  return (
    <Svg w={400} h={84} wide label={`${ft} feet of hose`}>
      <rect x={x0} y="28" width={w} height="22" rx="11" className="gtrack" />
      <rect x={x0} y="28" width={fx - x0} height="22" rx="11" className={ft > len ? 'gover' : 'gfill'} />
      <line x1={fx} y1="20" x2={fx} y2="58" className="gmark" /><text x={fx} y="14" className="gl c">{ft} ft to the fire</text>
      {[0, 50, 100, 150, 200].map((v) => <text key={v} x={x0 + w * v / len} y="76" className="gl c dim">{v}</text>)}
      <text x={x0 + w} y="14" className="gl r dim">{len} ft preconnect</text>
    </Svg>
  )
}

// ---------- door to person distance scale ----------
export function DistScale({ m, label }) {
  const x0 = 46; const x1 = 340; const ticks = Math.min(Math.floor(m), 40)
  return (
    <Svg w={400} h={70} wide label={`${m} meters`}>
      <rect x={x0 - 30} y="20" width="22" height="30" rx="2" className="pdoor" /><text x={x0 - 19} y="66" className="gl c dim">door</text>
      <line x1={x0} y1="35" x2={x1} y2="35" className="dline" />
      {Array.from({ length: ticks + 1 }, (_, i) => <line key={i} x1={x0 + (x1 - x0) * i / m} y1="30" x2={x0 + (x1 - x0) * i / m} y2="40" className="dtick" />)}
      <circle cx={x1 + 22} cy="28" r="7" className="pperson r" /><path d={`M${x1 + 10} 50c0-8 5-12 12-12s12 4 12 12`} className="pperson r" />
      <text x={(x0 + x1) / 2} y="22" className="gl c">{m} m{label ? ` · ${label}` : ''}</text>
    </Svg>
  )
}

export function Ring({ p, size = 64 }) {
  const r = size / 2 - 6; const c = 2 * Math.PI * r
  return (
    <Svg w={size} h={size} label={`${Math.round(p * 100)} percent sure`}>
      <circle cx={size / 2} cy={size / 2} r={r} className="rtrack" />
      <circle cx={size / 2} cy={size / 2} r={r} className="rfill" strokeDasharray={`${c * p} ${c}`} transform={`rotate(-90 ${size / 2} ${size / 2})`} />
      <text x={size / 2} y={size / 2 + 6} className="rtx">{Math.round(p * 100)}%</text>
    </Svg>
  )
}

// ---------- search path ----------
const MINI = {
  fire: <path d="M12 21c-5-3-6-9-1-14 0 4 3 5 3 8 2-2 2-5 1-7 5 3 7 9 2 13z" className="ifl" />,
  adj: <><rect x="3" y="5" width="8" height="14" rx="1" className="iad" /><rect x="13" y="5" width="8" height="14" rx="1" className="iad2" /></>,
  maze: <path d="M4 4h16v16H4zM8 4v12h8V8" className="imz" />,
  person: <><circle cx="12" cy="8" r="4" className="ip" /><path d="M5 21c0-5 3-8 7-8s7 3 7 8" className="ip" /></>,
}
const reasonIcon = (r = '') => (/fire area/i.test(r) && !/next/i.test(r) ? 'fire' : /next to/i.test(r) ? 'adj' : /self-evac|maze/i.test(r) ? 'maze' : 'person')
const Mini = ({ kind }) => <svg className="mi" viewBox="0 0 24 24" aria-hidden="true">{MINI[kind]}</svg>

export function SearchChain({ k, from = 1, n = 5, onRoom }) {
  return (
    <>
      <div className="chain">
        {k.plan_.slice(from, from + n).map((s, i) => (
          <button key={s.room_id} className="link" onClick={() => onRoom?.(s.room_id)}>
            <span className="node">{from + i + 1}</span><Mini kind={reasonIcon(s.reason)} /><b>{k.label(s.room_id)}</b>
            <span className="d">{k.routeOf(s.room_id) ? `${k.routeOf(s.room_id).distance_m} m out` : ''}</span>
          </button>
        ))}
      </div>
      <div className="legend2"><span><Mini kind="fire" />fire area</span><span><Mini kind="adj" />next to fire</span><span><Mini kind="maze" />hard to escape</span><span><Mini kind="person" />reported</span></div>
    </>
  )
}

// ---------- exit distance per room ----------
export function ExitBars({ k }) {
  const ids = [...new Set([...k.plan_.slice(0, 6).map((s) => s.room_id), k.deadEnd].filter(Boolean))]
  const rows = ids.map((id) => ({ id, m: k.routeOf(id)?.distance_m || 0 }))
  const mx = Math.max(1, ...rows.map((r) => r.m)); const W = 400
  return (
    <Svg w={W} h={rows.length * 34 + 8} wide label="Distance to the nearest exit per room">
      {rows.map((r, i) => {
        const y = i * 34 + 4; const w = (W - 170) * r.m / mx; const v = r.id === k.victim; const de = r.id === k.deadEnd
        return (
          <g key={r.id}>
            <text x="0" y={y + 19} className={`bl ${v ? 'v' : ''}`}>{k.label(r.id)}</text>
            <rect x="120" y={y + 4} width={w} height="22" rx="4" className={v ? 'bv' : de ? 'bd' : 'bb'} />
            <text x={126 + w} y={y + 20} className="bl n">{r.m} m{de ? ' · dead end' : ''}</text>
          </g>
        )
      })}
    </Svg>
  )
}

export const DeadEndPict = () => (
  <Svg w={120} h={106} label="Dead end room">
    <rect x="10" y="10" width="100" height="70" rx="3" className="drm" /><rect x="10" y="38" width="5" height="16" className="ddr" />
    <path d="M30 45h55M75 37l10 8-10 8" className="dx" /><path d="M88 20l14 14M102 20L88 34" className="dxx" />
    <text x="60" y="100" className="gl c dim">1 door · no window</text>
  </Svg>
)
