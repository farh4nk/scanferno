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

Real records (from `dispatch/extract.py`) also carry: `cross_street`, `fire_location`, per-person `trapped[].location` / `confidence` / optional `room_match` (why a room was picked), and `changed` (fields that moved this update: highlight these in the UI).

**Real calls to build the UI against:** `GET /calls/vibe-1-clean` returns the script, `audio_url`, `utterances` and `timeline` ([{t, utterance_index, record}]). `GET /calls/{id}/replay` streams the same as server-sent events (`utterance`, `record`, `done`) in call time; start the audio when the stream opens. Files: `fixtures/calls/<id>/`.

## 3. costar.json (built from the CoStar kit by `data/costar.py`)

Sample: [fixtures/sample/costar.json](../fixtures/sample/costar.json). Built per building from the kit: property facts (year built, stories, construction, sprinklers), floors, and current tenants with industry, floor, suite and square feet. Enum names come straight from the kit (`FirstFloor`, `Masonry`, `HealthCareAndSocialAssistance`). `vacant: true` is a hazard flag in itself.

## 4. briefing.json (Agent produces, Visuals renders)

Sample: [fixtures/sample/briefing.json](../fixtures/sample/briefing.json)

| Field | Meaning |
|---|---|
| `summary` | 2-3 sentence size-up readout |
| `hazards[]` | `kind`, `severity` (high, med, low), `text`, `source` (vexcel, matterport, costar, dispatch), optional `room_id` or `side` |
| `entry_points[]` | `side`, `door_id`, `text`, `sources`, optional `role` (search, attack) |
| `ladder_positions[]` | `side`, `text`, `sources`, optional `lat`/`lon` |
| `search_plan[]` | ordered `room_id` + `label` + `reason` + `sources` |
| `exit_routes[]` | `from_room_id`, `path` (room ids), `door_ids`, `exit_door_id`, `distance_m`, `polyline`, `sources`; with a known fire also `rerouted` and `through_avoided` |
| `hose_stretch[]` | per exterior door: `door_id`, `side`, `to_room_id`, `interior_m`, `total_ft`, `fits_preconnect` (200 ft), `text`, `sources` |
| `trapped[]` | `room_id`, `description`, `confidence` |
| `images` | view name -> image path under fixtures (nadir, oblique-north, ...) |
| `changes[]` | live stream only: `kind` (fire, trapped, search_plan, route, hazard), `text`, optional `room_id` / `severity` |

`sources` is a list drawn from `costar`, `vexcel`, `matterport`, `dispatch`. Live dispatch records also carry `corrections`: `{field: [{from, to, t}]}` for values the caller changed.

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

## 6. Search results (`GET /search`, `GET /properties/{id}`)

```json
{
  "query": "8866 gulf freeway",
  "results": [{
    "id": "costar-239873", "costar_property_id": 239873, "name": "Vibe Hobby",
    "address": "8866 Gulf Fwy, Houston, TX", "lat": 29.66, "lon": -95.26,
    "property_type": "Office", "stories": 5, "tenants": 40,
    "status": "ready", "building_id": "costar-239873",
    "scan": {"model_id": "szdeKc4TjsE", "rooms": 16, "doorways": 32},
    "score": 1.0, "match": "address"
  }],
  "geocoded": null,
  "nearby": []
}
```

`status: ready` means `building_id` works with every `/buildings/{id}` endpoint; `scanned` means CoStar facts and a Matterport scan exist but nothing is cached (`building_id` is null). `score` >= 0.75 is a confident match. With `geocode=true` and no confident match, `geocoded` is `{lat, lon, display_name}` and `nearby` lists the closest known buildings with `distance_m`. `/properties/{id}` returns one entry plus `nearest_ready` and, for scanned ones, `onboard_hint`.

## 7. Live session state (`/live/sessions/{sid}`, every live endpoint returns it)

```json
{
  "session_id": "bd44f87367", "building_id": "costar-239873",
  "utterances": [{"role": "caller", "text": "...", "start": 0.0, "end": 2.1}],
  "record": {"...": "dispatch.json, plus corrections"},
  "briefing": {
    "...": "briefing.json with changes",
    "heat": {"minutes": 2.5, "spread_m": 7.8, "rooms": {"r-kitchen": {"danger": 0.82, "zone": "untenable"}}, "zones": {}},
    "rescue": {"people": [{"id": "p1", "room_id": "...", "position": [0, 0], "entry": {"polyline": [], "text": "..."}, "extraction": {"polyline": [], "text": "..."}}]}
  },
  "building_match": {"query": "8866 Gulf Freeway", "hit": {"building_id": "costar-239873", "status": "ready", "score": 1.0}, "auto": true},
  "mayday": null,
  "minutes": 2.5,
  "updates": 3,
  "extracted": true
}
```

`extracted` is false when the caller lines didn't change, so the record is the same as before. `mayday` is the section 5 response once someone says "mayday". `heat` / `rescue` are nested on every live/replay briefing once fire or trapped facts exist (`agent/live_geometry.py`); cell grids are omitted from live payloads. `building_match.auto` is true only for a ready hit with score ≥ 0.75 — the UI may `POST /live/sessions/{sid}/building` to rebind. `POST .../tick` recomputes heat with elapsed minutes. `POST .../save` returns `{call_id}`. That call then works with `/calls/{id}`, `/replay` and `/live` like a scripted one (`script.json` has `"kind": "live"`). `/calls/{id}/live` also emits `building_match` SSE events.
