// One function per backend endpoint, grouped like backend/app/routers/. Add new endpoints here, not in components.
import { API, del, get, post, postForm, sseUrl } from './client'

export { API, asset } from './client'

const enc = encodeURIComponent

export const health = () => get('/health')

// routers/buildings.py
export const getBuildings = () => get('/buildings')
export const getBuilding = (id) => get(`/buildings/${id}`)
export const getFloorplan = (id) => get(`/buildings/${id}/floorplan`)
export const getRoute = (id, fromRoom, avoid = []) => get(`/buildings/${id}/routes`, { from_room: fromRoom, avoid: avoid.join(',') })
export const getMayday = (id, room) => get(`/buildings/${id}/mayday`, { room })
export const getEvac = (id, occupants) => get(`/buildings/${id}/evac`, { occupants })
export const getHose = (id, toRoom) => get(`/buildings/${id}/hose`, { to_room: toRoom })
export const extractDispatch = (id, transcript, useLlm) => post(`/buildings/${id}/dispatch`, { transcript, use_llm: useLlm })
export const getBriefing = (id, dispatch = {}) => post(`/buildings/${id}/briefing`, { dispatch, use_llm: false })
export const ask = (id, question, dispatch = {}) => post(`/buildings/${id}/ask`, { question, dispatch })

// routers/calls.py
export const getCalls = () => get('/calls')
export const getCall = (id) => get(`/calls/${id}`)
export const liveUrl = (callId, speed) => sseUrl(`/calls/${enc(callId)}/live`, { speed })

// routers/live.py: calls happening now (every call returns the session state)
export const createLiveSession = (buildingId) => post('/live/sessions', { building_id: buildingId })
export const liveAudio = (sid, blob, filename, firstRole) =>
  postForm(`/live/sessions/${sid}/audio`, { file: [blob, filename], first_role: firstRole })
export const liveUtterances = (sid, utterances) => post(`/live/sessions/${sid}/utterances`, { utterances })
export const saveLiveSession = (sid, title) => post(`/live/sessions/${sid}/save`, { title })
export const endLiveSession = (sid) => del(`/live/sessions/${sid}`)

// routers/search.py
// filters: { status: 'ready'|'scanned', city, kind: 'commercial'|'residential'|'other', costar: true|false }
export const search = (q, { limit = 8, offset = 0, geocode = false, filters = {} } = {}) =>
  get('/search', { q, limit, offset: offset || null, geocode: geocode || null, ...filters })
export const searchNear = (lat, lon, limit = 8) => get('/search', { lat, lon, limit })
export const getProperty = (key) => get(`/properties/${enc(key)}`)
export const getPropertyVexcel = (key) => get(`/properties/${enc(key)}/vexcel`)
export const propertyAerialUrl = (key, view = 'nadir') => `${API}/properties/${enc(key)}/aerial?view=${view}`
export const searchStats = () => get('/search/stats')
