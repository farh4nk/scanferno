export const API = import.meta.env.VITE_API_URL || 'http://localhost:8000'

async function j(path, opts) {
  const r = await fetch(`${API}${path}`, opts)
  if (!r.ok) {
    let msg = r.statusText
    try { msg = (await r.json()).detail || msg } catch { /* ignore */ }
    throw new Error(msg)
  }
  return r.json()
}

const post = (path, body) =>
  j(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })

export const asset = (p) => (p ? `${API}${p.startsWith('/') ? '' : '/'}${p}` : '')

export const getBuildings = () => j('/buildings')
export const getBuilding = (id) => j(`/buildings/${id}`)
export const getFloorplan = (id) => j(`/buildings/${id}/floorplan`)
export const getCalls = () => j('/calls')
export const getCall = (id) => j(`/calls/${id}`)
export const getMayday = (id, room) => j(`/buildings/${id}/mayday?room=${encodeURIComponent(room)}`)
export const getEvac = (id, n) => j(`/buildings/${id}/evac?occupants=${n}`)
export const getBriefing = (id, dispatch = {}) => post(`/buildings/${id}/briefing`, { dispatch, use_llm: false })
export const ask = (id, question, dispatch = {}) => post(`/buildings/${id}/ask`, { question, dispatch })
export const liveUrl = (callId, speed) => `${API}/calls/${callId}/live?speed=${speed}`
