// Low-level transport to the FastAPI backend. Endpoint functions live in ./index.js.
export const API = import.meta.env.VITE_API_URL || 'http://localhost:8000'

const qs = (params = {}) => {
  const p = Object.entries(params).filter(([, v]) => v != null && v !== '')
  return p.length ? `?${new URLSearchParams(p)}` : ''
}

export async function get(path, params, opts) {
  return request(`${path}${qs(params)}`, opts)
}

export async function post(path, body, opts) {
  return request(path, { ...opts, method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
}

export async function postForm(path, fields, opts) {
  const body = new FormData()
  Object.entries(fields).forEach(([k, v]) => { if (v != null) Array.isArray(v) ? body.append(k, ...v) : body.append(k, v) })
  return request(path, { ...opts, method: 'POST', body })
}

export async function del(path) {
  return request(path, { method: 'DELETE' })
}

async function request(path, opts) {
  const r = await fetch(`${API}${path}`, opts)
  if (!r.ok) {
    let msg = r.statusText
    try { msg = (await r.json()).detail || msg } catch { /* not JSON */ }
    throw new Error(msg)
  }
  return r.json()
}

// Absolute URL for a cached file path returned by the API ("fixtures/<id>/vexcel/nadir.jpg").
export const asset = (p) => (p ? `${API}${p.startsWith('/') ? '' : '/'}${p}` : '')

export const sseUrl = (path, params) => `${API}${path}${qs(params)}`
