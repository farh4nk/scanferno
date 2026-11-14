# Data contracts

The shapes passed between roles. Build against the samples in `fixtures/sample/` until real data lands. Change a shape only after telling the other two.

```
Matterport raw ──(Geometry)──> floorplan.json ──┐
Vexcel raw ─────────────────────────────────────┤
CoStar ── costar.json ──────────────────────────┼──(Agent)──> briefing.json ──(Visuals)──> UI
Call audio ──(Agent)──> dispatch.json ──────────┘
Geometry also serves: routes(from_room) and mayday(room) on top of floorplan.json
```

All coordinates are meters in the building's local frame (Matterport model center = 0,0). Rooms, doors and stairs all carry a `floor_id`.

## 1. floorplan.json (Geometry produces, Agent and Visuals consume)

Sample: [fixtures/sample/floorplan.json](../fixtures/sample/floorplan.json)

| Field | Meaning |
|---|---|
| `floors[]` | `id`, `label`, `sequence` (0 = ground) |
| `rooms[]` | `id`, `floor_id`, `label`, `type` (office, storage, kitchen, hallway, stairwell, restroom, lobby, other), `polygon` [[x,y],...], `centroid` [x,y] |
| `doors[]` | `id`, `floor_id`, `rooms` [roomA, roomB or `"outside"`], `position` [x,y], `width_m`, `type` (doorway or opening), `is_exit` |
| `stairs[]` | `id`, `room_id`, `connects` [floor ids] |
| `maze_score` | room id -> 0..1 disorientation risk (1 = worst). Optional until Geometry computes it |

## 2. dispatch.json (Agent produces from the call)

Sample: [fixtures/sample/dispatch.json](../fixtures/sample/dispatch.json)

Updated live as the transcript grows. `side` uses fireground sides: A = street front, then B, C (rear), D clockwise. `confidence` is 0..1 per field. `room_id` is set once a phrase is matched to the floor plan.

## 3. costar.json (built from the CoStar kit by `data/costar.py`)

Sample: [fixtures/sample/costar.json](../fixtures/sample/costar.json). Built per building from the kit: property facts (year built, stories, construction, sprinklers), floors, and current tenants with industry, floor, suite and square feet. Enum names come straight from the kit (`FirstFloor`, `Masonry`, `HealthCareAndSocialAssistance`). `vacant: true` is a hazard flag in itself.

## 4. briefing.json (Agent produces, Visuals renders)

Sample: [fixtures/sample/briefing.json](../fixtures/sample/briefing.json)

| Field | Meaning |
|---|---|
| `summary` | 2-3 sentence size-up readout |
| `hazards[]` | `kind`, `severity` (high, med, low), `text`, `source` (vexcel, matterport, costar, dispatch), optional `room_id` or `side` |
| `entry_points[]` | `side`, `door_id`, `text` |
| `ladder_positions[]` | `side`, `text`, optional `lat`/`lon` |
| `search_plan[]` | ordered `room_id` + `reason` |
| `exit_routes[]` | `from_room_id`, `path` (room ids), `door_ids`, `exit_door_id`, `distance_m` |
| `trapped[]` | `room_id`, `description`, `confidence` |
| `images` | view name -> image path under fixtures (nadir, oblique-north, ...) |

## 5. mayday response (Geometry produces)

```json
{
  "from_room_id": "r-302",
  "path": ["r-302", "r-hall", "r-lobby"],
  "exit_door_id": "d-front",
  "distance_m": 21.5,
  "directions": [
    "Left hand on the wall.",
    "Pass one door on your left.",
    "Turn right at the corner.",
    "Exit is 8 meters ahead."
  ]
}
```
