// Dev bench: exercise every 3D layer against the live backend and tune calibration. Not the product UI.
import {
  api, autoCalibrate, drawDoors, drawExits, drawLabels, drawMayday, drawOutline, drawRooms, drawRoute, drawWindows,
  evacPlayer, highlightRooms, openBuilding, type Building, type BuildingViewer, type Calibration, type EvacPlayer, type View,
} from '../index'

declare const __MP_SDK_KEY__: string

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T
const CAL_FIELDS = ['dx', 'dy', 'rotationDeg', 'floorHeight'] as const
const calKey = (bid: string) => `scanferno.calibration.${bid}`

let viewer: BuildingViewer | null = null
let player: EvacPlayer | null = null
let selectedRoom: string | null = null

async function main() {
  const buildings = await api.buildings()
  const sel = $<HTMLSelectElement>('building')
  sel.innerHTML = buildings.map((b) => `<option value="${b.id}">${b.name}</option>`).join('')
  const initial = new URLSearchParams(location.search).get('b') ?? 'costar-239873'
  sel.value = buildings.some((b) => b.id === initial) ? initial : buildings[0].id
  sel.onchange = () => {
    history.replaceState(null, '', `?b=${sel.value}`)
    load(buildings.find((b) => b.id === sel.value)!)
  }
  document.querySelectorAll<HTMLButtonElement>('[data-view]').forEach((b) => (b.onclick = () => changeView(b.dataset.view as View)))
  document.querySelectorAll<HTMLInputElement>('[data-layer]').forEach((c) => (c.onchange = () => {
    if (viewer) viewer.overlay.layer(c.dataset.layer!).visible = c.checked
  }))
  $<HTMLSelectElement>('coloring').onchange = drawStatic
  $<HTMLSelectElement>('room').onchange = (e) => select((e.target as HTMLSelectElement).value)
  $('route').onclick = showRoute
  $('mayday').onclick = showMayday
  $('evac').onclick = showEvac
  $('clear').onclick = clearFeatures
  $('evacPlay').onclick = () => player && (player.playing ? player.pause() : player.play())
  $<HTMLInputElement>('evacSeek').oninput = (e) => player?.seek(Number((e.target as HTMLInputElement).value))
  $<HTMLSelectElement>('evacSpeed').onchange = (e) => player && (player.speed = Number((e.target as HTMLSelectElement).value))
  for (const f of CAL_FIELDS) $<HTMLInputElement>(`cal-${f}`).oninput = () => viewer?.overlay.setCalibration(readCal())
  $('calAuto').onclick = async () => {
    if (!viewer) return
    const fit = await autoCalibrate(viewer.showcase.sdk, viewer.floorplan)
    viewer.overlay.setCalibration(fit.calibration)
    writeCal(fit.calibration)
  }
  $('calSave').onclick = () => viewer && localStorage.setItem(calKey(viewer.building.id), JSON.stringify(readCal()))
  $('calCopy').onclick = () => viewer && navigator.clipboard.writeText(`'${viewer.building.id}': ${JSON.stringify(readCal())},`)
  await load(buildings.find((b) => b.id === sel.value)!)
}

async function load(b: Building) {
  viewer?.destroy()
  viewer = null
  player = null
  selectedRoom = null
  $('status').textContent = `Loading ${b.name}…`
  const v = await openBuilding($('viewer'), b, { sdkKey: __MP_SDK_KEY__ })
  viewer = v
  const local = localStorage.getItem(calKey(b.id))
  if (local) v.overlay.setCalibration(JSON.parse(local))
  writeCal(v.overlay.calibration)
  const a = v.alignment
  $('status').textContent = `${v.floorplan.rooms.length} rooms, ${v.floorplan.doors.filter((d) => d.is_exit).length} exits · model ${b.matterport_model_id}`
  $('calInfo').textContent = local ? 'Using locally saved calibration.' : a.saved ? 'Using saved calibration.'
    : `Auto fit from ${a.source}: ${a.matched} rooms matched${a.rmsM != null ? `, ${a.rmsM} m RMS` : ''}.`
  $<HTMLSelectElement>('room').innerHTML = '<option value="">(select a room)</option>' +
    [...v.floorplan.rooms].sort((x, y) => x.label.localeCompare(y.label, undefined, { numeric: true }))
      .map((r) => `<option value="${r.id}">${r.label}</option>`).join('')
  drawStatic()
  v.onPick((p) => {
    $('pick').textContent = `${p.room?.label ?? 'No room'} · (${p.local[0].toFixed(2)}, ${p.local[1].toFixed(2)}) m` +
      (p.height != null ? ` · hit ${p.height.toFixed(2)} m up` : '')
    if (p.room) select(p.room.id)
  })
  await changeView('dollhouse')
}

async function changeView(view: View) {
  try {
    await viewer?.setView(view)
  } catch (e) {
    $('info').textContent = `Showcase refused ${view} view (still loading, or disabled for this model): ${e}`
  }
}

function drawStatic() {
  if (!viewer) return
  const { overlay, floorplan: fp } = viewer
  const layers = {
    rooms: () => drawRooms(overlay.layer('rooms'), fp, $<HTMLSelectElement>('coloring').value as 'type' | 'maze'),
    labels: () => drawLabels(overlay.layer('labels'), fp),
    outline: () => drawOutline(overlay.layer('outline'), fp),
    doors: () => drawDoors(overlay.layer('doors'), fp),
    exits: () => drawExits(overlay.layer('exits'), fp),
    windows: () => drawWindows(overlay.layer('windows'), fp),
  }
  for (const [name, draw] of Object.entries(layers)) {
    const layer = overlay.layer(name)
    layer.clear()
    draw()
    layer.visible = document.querySelector<HTMLInputElement>(`[data-layer="${name}"]`)!.checked
  }
}

function select(roomId: string) {
  if (!viewer) return
  selectedRoom = roomId || null
  $<HTMLSelectElement>('room').value = roomId
  const layer = viewer.overlay.layer('selection')
  layer.clear()
  if (selectedRoom) highlightRooms(layer, viewer.floorplan, [selectedRoom], '#facc15', { pulse: true })
}

function clearFeatures() {
  if (!viewer) return
  for (const n of ['route', 'mayday', 'evac']) viewer.overlay.layer(n).clear()
  player = null
  $('info').textContent = ''
}

async function showRoute() {
  if (!viewer || !selectedRoom) return void ($('info').textContent = 'Select a room first.')
  const route = await api.route(viewer.building.id, selectedRoom)
  const layer = viewer.overlay.layer('route')
  layer.clear()
  drawRoute(layer, route, viewer.floorplan)
  $('info').textContent = `Route: ${route.distance_m} m via ${route.path.length} rooms to ${route.exit_door_id}`
}

async function showMayday() {
  if (!viewer || !selectedRoom) return void ($('info').textContent = 'Select a room first.')
  const m = await api.mayday(viewer.building.id, selectedRoom)
  const layer = viewer.overlay.layer('mayday')
  layer.clear()
  drawMayday(layer, m, viewer.floorplan)
  $('info').innerHTML = `${m.distance_m} m, exit ${m.exit_side ?? '?'}${m.advisory ? `<br>${m.advisory}` : ''}<ol>${m.directions.map((d) => `<li>${d}</li>`).join('')}</ol>`
}

async function showEvac() {
  if (!viewer) return
  const occ = Number($<HTMLInputElement>('occupants').value) || undefined
  const evac = await api.evac(viewer.building.id, occ)
  const layer = viewer.overlay.layer('evac')
  layer.clear()
  player = evacPlayer(layer, viewer.floorplan, evac)
  player.speed = Number($<HTMLSelectElement>('evacSpeed').value)
  const seek = $<HTMLInputElement>('evacSeek')
  seek.max = String(player.duration)
  player.onTime = (t) => (seek.value = String(t))
  player.play()
  $('info').textContent = `${evac.occupants} occupants, clear in ${evac.clear_time_s} s\n${evac.advice.join('\n')}`
}

function readCal(): Calibration {
  return Object.fromEntries(CAL_FIELDS.map((f) => [f, Number($<HTMLInputElement>(`cal-${f}`).value) || 0])) as unknown as Calibration
}

function writeCal(c: Calibration) {
  for (const f of CAL_FIELDS) $<HTMLInputElement>(`cal-${f}`).value = String(c[f])
}

main().catch((e) => {
  console.error(e)
  $('status').textContent = String(e)
})
