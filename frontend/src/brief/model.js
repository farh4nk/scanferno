// Turns the floor plan + briefing (+ live dispatch record) into the facts the briefing screens draw.
// Everything here is derived from API data; nothing is specific to one building.

export const SIDE_NAME = { A: 'front', B: 'left', C: 'rear', D: 'right' }
const COMPASS_VIEW = { N: 'oblique-north', S: 'oblique-south', E: 'oblique-east', W: 'oblique-west' }

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
  const victim = trapped[0]?.room_id || null
  const fireIds = (b.fire_room_ids || []).filter((id) => R[id])
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
    R, doors, label, routeOf, plan_, trapped, victim, victimLabel: victim ? label(victim) : null,
    victimConf: trapped[0]?.confidence ?? null, victimWords: rec?.trapped?.[0]?.location || trapped[0]?.description || '',
    fireIds, fireKnown, floor, side, watch, isO2, search, attack, searchRoom: doorRoom(doors[search?.door_id]),
    exits, exitSides, vRoute, vExitSide, distToVictim, deadEnd, hose, bld, frontView,
    stories: bld.stories, roof: bld.roof_height_m, people: b.occupancy?.employees_on_floor,
    ladders: (b.ladder_positions || []).map((l) => l.side), caveats: b.caveats || [],
  }
}

// What the briefing says out loud (and shows in Read mode), one paragraph per step.
export function stepScript(k, i) {
  if (!k) return ''
  const B = k.bld
  if (i === 0) return [
    `Arriving at ${B.name || 'the building'}${k.stories ? `, ${k.stories} story` : ''}${B.construction ? ` ${B.construction.toLowerCase()}` : ''} building${B.sprinklers ? ', sprinklered' : ''}.`,
    `Front is side A.`,
    k.fireKnown ? `Fire reported${k.side ? ` side ${k.side}, the ${SIDE_NAME[k.side]}` : ''}${k.floor ? `, floor ${k.floor}` : ''}.` : 'No fire location reported yet.',
    k.ladders.length ? `Aerial device on ${k.ladders.join(' and ')}.` : '',
  ].filter(Boolean).join(' ')
  if (i === 1) return [
    k.search ? `Search crew enters side ${k.search.side} through the door into ${k.searchRoom}.` : '',
    k.hose ? `Attack line about ${k.hose.total_ft} feet to the fire${k.hose.fits_preconnect ? ', inside a 200 foot preconnect' : ', longer than a preconnect'}.` : '',
    k.watch ? `Watch for ${k.watch.text.replace(/^Caller reports /, '').replace(/\.$/, '').toLowerCase()}.` : '',
  ].filter(Boolean).join(' ')
  if (i === 2) return k.victim
    ? `Trapped: ${shortWho(k.trapped[0].description)}, likely in ${k.victimLabel}${k.distToVictim ? `, about ${k.distToVictim} meters from the door` : ''}. Then search ${k.plan_.slice(1, 4).map((s) => k.label(s.room_id)).join(', ')}.`
    : `No one reported trapped yet. Search ${k.plan_.slice(0, 3).map((s) => k.label(s.room_id)).join(', ')}.`
  return [
    k.vRoute ? `Nearest exit from ${k.victimLabel} is ${k.vRoute.distance_m} meters${k.vExitSide ? `, side ${k.vExitSide}` : ''}.` : `${k.exits.length} exits on side ${k.exitSides.join(', ')}.`,
    k.deadEnd ? `${k.label(k.deadEnd)} is a dead end.` : '',
    'If lost, call a mayday and follow the wall.',
  ].filter(Boolean).join(' ')
}

export const STEPS = ['Arrive', 'Enter', 'Search', 'Get out']

const HAZARD_NAME = { disorientation: 'Dead ends', life_hazard: 'People inside', medical: 'Medical tenant', collapse: 'Collapse risk',
  roof: 'Roof', sprinklers: 'No sprinklers', chemicals: 'Chemicals', gas: 'Gas', solar: 'Solar panels', entry: 'Entry', reported: 'Reported hazard' }
export const hazardName = (h) => (!h ? '' : /oxygen|o2\b|cylinder/i.test(h.text) ? 'O₂ cylinders' : /gas/i.test(h.text) ? 'Gas' : HAZARD_NAME[h.kind] || h.kind.replace(/_/g, ' '))
export const shortWho = (d) => (d || 'one person').split(/,| went | is | was | she| he | they/)[0].trim()
