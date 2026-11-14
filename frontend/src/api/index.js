// One function per backend endpoint, grouped like backend/app/routers/. Add new endpoints here, not in components.
import { get, post, sseUrl } from './client'

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

// routers/search.py
export const search = (q, { limit = 8, geocode = false } = {}) => get('/search', { q, limit, geocode: geocode || null })
export const searchNear = (lat, lon, limit = 8) => get('/search', { lat, lon, limit })
export const getProperty = (key) => get(`/properties/${enc(key)}`)
