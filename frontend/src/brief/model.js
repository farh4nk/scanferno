// Turns the floor plan + briefing (+ live dispatch record) into the facts the briefing screens draw.
// Everything here is derived from API data; nothing is specific to one building.

export const SIDE_NAME = { A: 'front', B: 'left', C: 'rear', D: 'right' }
// Vexcel names an oblique by the way the camera looks: the south wall is seen in oblique-north
const COMPASS_VIEW = { N: 'oblique-south', S: 'oblique-north', E: 'oblique-west', W: 'oblique-east' }

// Plan coordinates are meters with y up; the SVG view flips y and scales.
export function makeView(plan, scale = 40, pad = 1.6) {
  const pts = plan.rooms.flatMap((r) => r.polygon)
  const xs = pts.map((p) => p[0]); const ys = pts.map((p) => p[1])
  const x0 = Math.min(...xs); const x1 = Math.max(...xs); const y0 = Math.min(...ys); const y1 = Math.max(...ys)
  const W = (x1 - x0 + 2 * pad) * scale; const H = (y1 - y0 + 2 * pad) * scale
  const p = ([x, y]) => [(x - x0 + pad) * scale, (y1 - y + pad) * scale]
  const str = (poly) => poly.map((q) => p(q).map((v) => v.toFixed(0)).join(',')).join(' ')
  return { W, H, p, str }
}

export function deriveBrief(plan, b, rec) {
  if (!plan || !b) return null
  const R = Object.fromEntries(plan.rooms.map((r) => [r.id, r]))
  const doors = Object.fromEntries(plan.doors.map((d) => [d.id, d]))
  const label = (id) => R[id]?.label || id
  const routes = Object.fromEntries((b.exit_routes || []).map((r) => [r.from_room_id, r]))
  const routeOf = (id) => routes[id] || plan.exit_routes?.[id] || null

  const trapped = (b.trapped || []).filter((t) => t.room_id && R[t.room_id])
  const rescuePeople = (b.rescue?.people || []).filter((p) => p.located && p.room_id && R[p.room_id])
  const victim = rescuePeople[0]?.room_id || trapped[0]?.room_id || null
  const fireIds = (b.fire_room_ids || []).filter((id) => R[id])
  const heatRooms = b.heat?.rooms || null
  const floor = rec?.floor ?? b.occupancy?.floor ?? null
  const side = rec?.side || null
  const fireKnown = fireIds.length > 0 || !!side

  const hz = b.hazards || []
  const watch = hz.find((h) => h.source === 'dispatch') || hz.find((h) => h.severity === 'high') || null
  const isO2 = !!watch && /oxygen|o2\b|cylinder/i.test(watch.text)

  const doorRoom = (d) => d && label(d.rooms.find((r) => r !== 'outside'))
  const entries = b.entry_points || []
  const search = entries.find((e) => e.role === 'search') || entries[0] || null
  const attack = entries.find((e) => e.role === 'attack') || null
  const exits = plan.doors.filter((d) => d.is_exit)
  const exitSides = [...new Set(exits.map((d) => d.side).filter(Boolean))].sort()

  const vRoute = victim ? routeOf(victim) : null
  const vExitSide = vRoute ? doors[vRoute.exit_door_id]?.side : null
  const distToVictim = (() => { const m = search?.text?.match(/([\d.]+) m to the reported victim/); return m ? +m[1] : vRoute?.distance_m ?? null })()

  const deadEnd = Object.entries(plan.maze_detail || {}).filter(([, m]) => m.dead_end)
    .sort((a, c) => (plan.maze_score?.[c[0]] || 0) - (plan.maze_score?.[a[0]] || 0))[0]?.[0] || null

  const bld = b.building || {}
  const front = bld.front || 'S'
  const frontView = b.images?.[COMPASS_VIEW[front]] ? COMPASS_VIEW[front] : 'nadir'
  const hose = (b.hose_stretch || [])[0] || null
  const plan_ = (b.search_plan || []).filter((s) => R[s.room_id])

  return {
    R, doors, label, routeOf, plan_, trapped, rescuePeople, victim, victimLabel: victim ? label(victim) : null,
    victimConf: rescuePeople[0]?.room_confidence ?? trapped[0]?.confidence ?? null,
    victimWords: rescuePeople[0]?.said || rec?.trapped?.[0]?.location || trapped[0]?.description || '',
    fireIds, fireKnown, heatRooms, heatMinutes: b.heat?.minutes ?? b.minutes ?? null,
    floor, side, watch, isO2, search, attack, searchRoom: doorRoom(doors[search?.door_id]),
    exits, exitSides, vRoute, vExitSide, distToVictim, deadEnd, hose, bld, frontView,
    stories: bld.stories, roof: bld.roof_height_m, people: b.occupancy?.employees_on_floor,
    ladders: (b.ladder_positions || []).map((l) => l.side), caveats: b.caveats || [],
    rescueFactors: b.rescue?.factors || [],
  }
}

// What the briefing says out loud (and shows in Read mode), in dispatch radio style: terse, numbers first,
// fireground phonetics for sides, ordinal floors, no filler. Read to a crew en route.
const PHON = { A: 'Alpha', B: 'Bravo', C: 'Charlie', D: 'Delta' }
const NUM = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten']
const ORDN = ['', 'first', 'second', 'third', 'fourth', 'fifth', 'sixth', 'seventh', 'eighth', 'ninth', 'tenth']
const num = (n) => (Number.isInteger(n) && n <= 10 ? NUM[n] : String(n))
const sideOf = (s) => (s ? `${PHON[s] || s} side` : '')
const floorOf = (f) => (ORDN[f] ? `${ORDN[f]} floor` : `floor ${f}`)
const short = (l) => (l || '').replace(/^Office (\d+)/, '$1')
// street abbreviations read badly aloud ("Fwy"); expand them, and start every sentence with a capital
const STREET = { Fwy: 'Freeway', St: 'Street', Rd: 'Road', Ave: 'Avenue', Blvd: 'Boulevard', Dr: 'Drive', Pkwy: 'Parkway', Hwy: 'Highway', Ln: 'Lane', Ct: 'Court', Pl: 'Place' }
const spoken = (t) => t.replace(/\b(Fwy|St|Rd|Ave|Blvd|Dr|Pkwy|Hwy|Ln|Ct|Pl)\b/g, (m, w) => STREET[w]).replace(/(^|\. )([a-z])/g, (m, p, c) => p + c.toUpperCase())
export function stepScript(k, i) { return spoken(rawScript(k, i)) }
function rawScript(k, i) {
  if (!k) return ''
  const B = k.bld
  if (i === 0) return [
    `${B.name || 'Building'}${B.address ? `, ${B.address.split(',')[0]}` : ''}.`,
    [k.stories && `${num(k.stories)}-story`, B.construction?.toLowerCase()].filter(Boolean).join(' ') + (B.sprinklers ? ', sprinklered.' : '.'),
    k.fireKnown ? `Fire${k.side ? `, ${sideOf(k.side)}` : ''}${k.floor ? `, ${floorOf(k.floor)}` : ''}.` : 'Fire location unknown.',
    k.ladders.length ? `Aerial to ${k.ladders.map((x) => PHON[x] || x).join(' and ')}.` : '',
  ].filter(Boolean).join(' ')
  if (i === 1) return [
    k.search ? `Search: ${sideOf(k.search.side)} door, ${k.searchRoom}.` : '',
    k.hose ? `Attack: ${k.hose.total_ft} feet${k.hose.fits_preconnect ? ', preconnect' : ', extend the line'}.` : '',
    k.watch ? `Caution: ${hazardName(k.watch).replace('O₂', 'oxygen').toLowerCase()}.` : '',
  ].filter(Boolean).join(' ')
  if (i === 2) return k.victim
    ? `Trapped: one, ${shortWho(k.trapped[0].description).replace(/^./, (c) => c.toLowerCase())}, ${k.victimLabel}${k.distToVictim ? `, ${Math.round(k.distToVictim)} meters in` : ''}. Secondary: ${k.plan_.slice(1, 4).map((s) => short(k.label(s.room_id))).join(', ')}.`
    : `No trapped reported. Primary search: ${k.plan_.slice(0, 3).map((s) => short(k.label(s.room_id))).join(', ')}.`
  return [
    k.vRoute ? `Egress: ${Math.round(k.vRoute.distance_m)} meters, ${sideOf(k.vExitSide)}.` : `${num(k.exits.length)} exits, ${k.exitSides.map((x) => PHON[x] || x).join(' and ')}.`,
    k.deadEnd ? `${k.label(k.deadEnd)}, dead end.` : '',
    'If lost, call a mayday and follow the wall.',
  ].filter(Boolean).join(' ')
}

export const STEPS = ['Arrive', 'Enter', 'Search', 'Get out']

const HAZARD_NAME = { disorientation: 'Dead ends', life_hazard: 'People inside', medical: 'Medical tenant', collapse: 'Collapse risk',
  roof: 'Roof', sprinklers: 'No sprinklers', chemicals: 'Chemicals', gas: 'Gas', solar: 'Solar panels', entry: 'Entry', reported: 'Reported hazard' }
export const hazardName = (h) => (!h ? '' : /oxygen|o2\b|cylinder/i.test(h.text) ? 'O₂ cylinders' : /gas/i.test(h.text) ? 'Gas' : HAZARD_NAME[h.kind] || h.kind.replace(/_/g, ' '))
export const shortWho = (d) => (d || 'one person').split(/,| went | is | was | she| he | they/)[0].trim()
