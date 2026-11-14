// Minimal fetchers for the backend endpoints the 3D layers draw. Paths are proxied to :8000 in dev.
import type { Building, Evac, Floorplan, Mayday, Route } from './types'

let base = ''

/** Point at another backend (default: same origin, proxied by vite to http://localhost:8000). */
export function setApiBase(url: string) {
  base = url.replace(/\/$/, '')
}

async function get<T>(path: string): Promise<T> {
  const r = await fetch(base + path)
  if (!r.ok) throw new Error(`${r.status} ${path}: ${await r.text()}`)
  return r.json() as Promise<T>
}

const q = encodeURIComponent

export const api = {
  buildings: () => get<Building[]>('/buildings'),
  floorplan: (bid: string) => get<Floorplan>(`/buildings/${bid}/floorplan`),
  route: (bid: string, fromRoom: string) => get<Route>(`/buildings/${bid}/routes?from_room=${q(fromRoom)}`),
  mayday: (bid: string, room: string) => get<Mayday>(`/buildings/${bid}/mayday?room=${q(room)}`),
  evac: (bid: string, occupants?: number) => get<Evac>(`/buildings/${bid}/evac${occupants ? `?occupants=${occupants}` : ''}`),
}
