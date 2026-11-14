// Shapes served by the backend (docs/CONTRACTS.md). All coordinates are floor plan meters:
// x east, y north, relative to the Matterport model center.

export type XY = [number, number]

export interface Building {
  id: string
  name: string
  address: string
  lat: number
  lon: number
  matterport_model_id: string
  front: string
  scan_rotation_deg: number
}

export interface Room {
  id: string
  floor_id: string
  label: string
  type: string
  type_inferred?: boolean
  polygon: XY[]
  holes?: XY[][]
  centroid: XY
  area_m2?: number
  matterport_id?: string
  side?: string
  exterior_sides?: string[]
}

export interface Door {
  id: string
  floor_id: string
  rooms: [string, string]
  position: XY
  width_m: number
  type: 'doorway' | 'opening'
  is_exit: boolean
  side?: string
  inferred?: boolean
}

export interface Window {
  id: string
  floor_id: string
  room_id: string
  position: XY
  width_m: number
  sill_m: number
  exterior: boolean
  side?: string
}

export interface Route {
  from_room_id: string
  path: string[]
  door_ids: string[]
  exit_door_id: string
  distance_m: number
  polyline: XY[]
}

export interface Floorplan {
  building_id: string
  units: 'meters'
  floors: { id: string; label: string; sequence: number }[]
  rooms: Room[]
  doors: Door[]
  windows: Window[]
  stairs: unknown[]
  voids: XY[][]
  outline: XY[]
  maze_score?: Record<string, number>
  maze_detail?: Record<string, { why?: string[] }>
  exit_routes?: Record<string, Route>
}

export interface Mayday {
  from_room_id: string
  path: string[]
  door_ids: string[]
  exit_door_id: string | null
  exit_side: string | null
  hand: 'left' | 'right' | null
  distance_m: number | null
  shortest_m: number | null
  advisory?: string | null
  doors_passed: number
  directions: string[]
  wall_path: XY[]
}

export interface EvacFrame {
  t: number
  agents: (XY | null)[]
  queues: Record<string, number>
}

export interface Evac {
  occupants: number
  clear_time_s: number
  per_exit: Record<string, number>
  bottleneck_door_id: string | null
  peak_queue: Record<string, number>
  advice: string[]
  frames: EvacFrame[]
  agent_rooms: string[]
}
