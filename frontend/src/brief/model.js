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
  const rescuePeople = (b.rescue?.people || []).filter((p) => !p.room_id || R[p.room_id])
  const locatedPeople = rescuePeople.filter((p) => p.located && p.room_id && R[p.room_id])
  const victim = locatedPeople[0]?.room_id || trapped[0]?.room_id || null
  const fireIds = (b.fire_room_ids || []).filter((id) => R[id])
  const heatRooms = b.heat?.rooms || null
  const floor = rec?.floor ?? b.occupancy?.floor ?? null
  const side = rec?.side || null
  const fireKnown = fireIds.length > 0 || !!side

  const hz = b.hazards || []
  const watch = hz.find((h) => h.source === 'dispatch') || hz.find((h) => h.severity === 'high') || null
  const reported = hz.filter((h) => h.source === 'dispatch')
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
    victimConf: locatedPeople[0]?.room_confidence ?? trapped[0]?.confidence ?? null,
    victimWords: locatedPeople[0]?.said || rec?.trapped?.[0]?.location || trapped[0]?.description || '',
    fireIds, fireKnown, heatRooms, heatMinutes: b.heat?.minutes ?? b.minutes ?? null,
    floor, side, watch, reported, isO2, search, attack, searchRoom: doorRoom(doors[search?.door_id]),
    exits, exitSides, vRoute, vExitSide, distToVictim, deadEnd, hose, bld, frontView,
    stories: bld.stories, roof: bld.roof_height_m, people: b.occupancy?.employees_on_floor,
    ladders: (b.ladder_positions || []).map((l) => l.side), caveats: b.caveats || [], age: b.data_age || null, conf: rec?.confidence || {},
    call: rec ? { address: rec.address, where: rec.fire_location, conditions: rec.conditions || [], callerAt: rec.caller_location } : null,
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
// `live`: a briefing built from the call you just took opens with what the caller said (demo scripts stay as they are)
export function stepScript(k, i, live = false) { return spoken(live && i === 0 && k?.call ? liveOpening(k) : rawScript(k, i)) }
const lower1 = (t) => (t ? t.charAt(0).toLowerCase() + t.slice(1) : t)
function liveOpening(k) {
  const B = k.bld; const c = k.call
  const where = (c.address || B.address || '').split(',')[0]
  return [
    'Call briefing.',
    where ? `${where}.` : '',
    c.where ? `${c.where.replace(/\.$/, '')}.` : '',
    k.fireKnown ? `Fire${k.side ? `, ${sideOf(k.side)}` : ''}${k.floor ? `, ${floorOf(k.floor)}` : ''}.` : 'Fire location unknown.',
    c.conditions.length ? `${c.conditions.slice(0, 2).join(', ')}.` : '',
    k.ladders.length ? `Aerial to ${k.ladders.map((x) => PHON[x] || x).join(' and ')}.` : '',
    c.callerAt ? `Caller is ${lower1(c.callerAt.replace(/\.$/, ''))}.` : '',
  ].filter(Boolean).join(' ')
}
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
    cautionLine(k),
  ].filter(Boolean).join(' ')
  if (i === 2 && k.trapped.length > 1) return `Trapped: ${num(k.trapped.length)}. ${k.trapped.slice(0, 3).map((t) => `${shortWho(t.description)}, ${k.label(t.room_id)}`).join('. ')}.`
  if (i === 2) return k.victim
    ? `Trapped: one, ${shortWho(k.trapped[0]?.description ?? k.rescuePeople[0]?.description).replace(/^./, (c) => c.toLowerCase())}, ${k.victimLabel}${k.distToVictim ? `, ${Math.round(k.distToVictim)} meters in` : ''}. Secondary: ${k.plan_.slice(1, 4).map((s) => short(k.label(s.room_id))).join(', ')}.`
    : `No trapped reported. Primary search: ${k.plan_.slice(0, 3).map((s) => short(k.label(s.room_id))).join(', ')}.`
  return [
    k.vRoute ? `Egress: ${Math.round(k.vRoute.distance_m)} meters, ${sideOf(k.vExitSide)}.` : `${num(k.exits.length)} exits, ${k.exitSides.map((x) => PHON[x] || x).join(' and ')}.`,
    k.deadEnd ? `${k.label(k.deadEnd)}, dead end.` : '',
    'If lost, call a mayday and follow the wall.',
  ].filter(Boolean).join(' ')
}

// what the caller reported (two hazards at most), else the building's top risk
const spokenHazard = (h) => (/oxygen|o2\b|cylinder/i.test(h.text) ? 'oxygen cylinders' : h.text.replace(/^Caller reports /i, '').replace(/\.$/, '').toLowerCase())
function cautionLine(k) {
  const list = k.reported.length ? k.reported.slice(0, 2).map(spokenHazard) : k.watch ? [hazardName(k.watch).replace('O₂', 'oxygen').toLowerCase()] : []
  return list.length ? `Caution: ${list.join(', ')}.` : ''
}

export const STEPS = ['Arrive', 'Enter', 'Search', 'Get out']

const HAZARD_NAME = { disorientation: 'Dead ends', life_hazard: 'People inside', medical: 'Medical tenant', collapse: 'Collapse risk',
  roof: 'Roof', sprinklers: 'No sprinklers', chemicals: 'Chemicals', gas: 'Gas', solar: 'Solar panels', entry: 'Entry', reported: 'Reported hazard' }
export const hazardName = (h) => (!h ? '' : /oxygen|o2\b|cylinder/i.test(h.text) ? 'O₂ cylinders' : /gas/i.test(h.text) ? 'Gas' : HAZARD_NAME[h.kind] || h.kind.replace(/_/g, ' '))
export const shortWho = (d) => (d || 'one person').split(/,| went | is | was | she| he | they/)[0].trim()
