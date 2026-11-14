# Scanferno: context for coding agents

Read this first, then [docs/STATUS.md](docs/STATUS.md) for what's done and what's next. Data shapes between roles: [docs/CONTRACTS.md](docs/CONTRACTS.md). Product plan and demo moments: [docs/PLAN.md](docs/PLAN.md).

## What we're building

HackPrinceton 2026 (deadline 8 am Sunday Nov 15). When a fire call comes in, Scanferno turns CoStar, Matterport and Vexcel data into a firefighter pre-entry briefing in seconds: hazards, entry points, search plan, exit routes, and wall-following "mayday" directions for a lost crew. A live dispatch call (audio) is transcribed and turned into structured facts that reshape the briefing as the caller talks.

## Who owns what

Work only in your own folder and branch; ask before editing someone else's.

| Role | Folder | Branch |
|---|---|---|
| Agent and data | `backend/data/`, `backend/dispatch/`, `backend/agent/`, `backend/scripts/`, `backend/app/` | `agent-data` |
| Geometry | `backend/geometry/` | `geometry` |
| Visuals and pitch | `frontend/` | `ui` |
| 3D model overlays | `viewer3d/` | `matterport-3d` |

Shared: `fixtures/` (cached data, anyone may read), `docs/`. Merge to `main` through PRs.

## Setup

```bash
cp .env.example .env                 # get keys from the team; never commit .env
# CoStar kit (404 MB, not in git): unzip costar-hackathon-kit.zip to ./costar-kit/
cd backend && python3 -m venv .venv && .venv/bin/pip install -r requirements.txt
.venv/bin/python -m scripts.check_access        # all 5 sources should say OK
.venv/bin/uvicorn app.main:app --reload         # API on http://localhost:8000
cd ../viewer3d && npm install && npm run dev    # 3D dev bench on http://localhost:5173 (needs the API)
```

You don't need any keys to build against cached data: everything for the 3 hero buildings and 2 calls is already in `fixtures/` and served by the API.

## Hero buildings (Houston, all cached in `fixtures/<id>/`)

| id | Building | Why |
|---|---|---|
| `costar-239873` | Vibe Hobby, 8866 Gulf Fwy | **Main demo.** 16 rooms with real types (Office, Hallway, Kitchen), 32 doorways. Both scripted calls are here |
| `costar-350372` | Bellaire Medical, 6550 Mapleridge | Most rooms (35) and doorways (44); rooms typed only Other/Void |
| `costar-23553` | Piney Point Offices II, 2500 Fondren | 20 rooms; types Other/Void |

Per building: `matterport_vector.json` (raw floor plan), `costar.json` (building facts + tenants), `vexcel/{nadir,oblique-north,oblique-east,oblique-south,oblique-west}.jpg`, `vexcel/elevation.json`, `vexcel/structure_metadata_extract.json` (roof material/condition/solar, roof objects, footprint), `vexcel/structure_geometry_metadata_extract.json` (footprint polygon).

## API (backend/app/routers/, wired in app/main.py)

One router file per area (`buildings.py`, `calls.py`, `dispatch.py`, `search.py`); shared 404 lookups in `app/deps.py`. The frontend mirrors this with one function per endpoint in `frontend/src/api/index.js`; components and hooks (`frontend/src/hooks/`) never call `fetch` directly. Adding an endpoint means touching both, plus a test.

| Endpoint | Returns |
|---|---|
| `GET /buildings` | hero buildings list |
| `GET /fixtures/<path>` | any cached file (images, audio, JSON) |
| `GET /calls` | scripted calls |
| `GET /calls/{id}` | script, `audio_url`, `utterances`, `timeline` of dispatch records |
| `GET /calls/{id}/replay?speed=1` | SSE in call time: `utterance`, `record`, `done` events. Start the audio when the stream opens |
| `POST /dispatch/extract` | `{building_id, transcript:[{role,text}], previous}` -> updated dispatch record (typed fallback) |
| `POST /dispatch/transcribe` | upload audio (+ `first_role`) -> speaker-separated utterances; 503 without `ELEVENLABS_API_KEY` |
| `POST /live/sessions` | `{building_id}` -> live call session. Then `POST .../{sid}/audio` (whole recording so far, re-transcribed), `POST .../{sid}/utterances` (browser speech / typed lines), `GET .../{sid}`, `POST .../{sid}/save` -> replayable `live-<id>` call, `DELETE .../{sid}`. Each returns `{utterances, record, briefing, mayday, updates}` |
| `GET /health` | `{ok, llm, stt, buildings}`: which keys are configured |
| `GET /calls/{id}/live?speed=1` | SSE like `/replay` plus `briefing` after each record (with `changes`) and `mayday` (wall-following directions) for mayday calls; records carry `corrections` |
| `GET /buildings/{id}` | building + CoStar + Vexcel summary (roof, footprint, sides, images) |
| `GET /buildings/{id}/floorplan` | `floorplan.json` with `maze_score`, `maze_detail`, `exit_routes`, sides |
| `GET /buildings/{id}/routes?from_room=&avoid=` | shortest route to an exit (room id, label or description), optionally around rooms (fire) |
| `GET /buildings/{id}/hose?to_room=` | hose length from each exterior door to a room vs a 200 ft preconnect |
| `GET /search?q=&geocode=` | address/name search over hero buildings (`ready`) and 97 scanned CoStar properties (`scanned`); unknown addresses geocoded to the nearest known buildings |
| `GET /properties/{id}` | one searched property + nearest buildings with a briefing |
| `GET /buildings/{id}/mayday?room=` | wall-following directions out (room id, label or mayday text) |
| `GET /buildings/{id}/evac?occupants=` | evacuation sim: clear time, bottleneck door, frames |
| `POST /buildings/{id}/dispatch` | `{transcript, use_llm}` -> dispatch record with room candidates (Gemini or offline rules) |
| `POST /buildings/{id}/briefing` | `{dispatch, use_llm}` -> `briefing.json` |
| `POST /buildings/{id}/ask` | `{question, dispatch}` -> answer + highlight |

## Data quirks that will bite you

- **Matterport vector data** (`matterport_vector.json`): `floors[]` and `rooms[]` are separate lists; rooms have no floor id. Each room has `boundary.edges[]` with `vertices[].position {x,y}` (2D, relative to model center; units look like meters but the docs don't say) and `openings[]` (`type` "doorway" or "opening", `width`, `relativeCenter` 0..1 along the edge). Edge `type` is "wall" or "invisible". Room type is `classifications[].label`; skip rooms typed only "Void". Room `label` is usually missing.
- **Every hero scan covers one floor** (a single suite), even in multi-story buildings. No stairs between floors.
- **No hero building has solar panels** (Vexcel `roof-objects.solar.value` is false).
- **Building sides** (A front/street, B left, C rear, D right) come from `front` (compass side facing the street) and `scan_rotation_deg` in buildings.json (`geometry/sides.py`); both are set by hand per building.
- **CoStar enums** are ints in the kit; `data/costar.py` decodes them to names (`FirstFloor`, `Masonry`). Many tenants are "Unknown tenant".
- **Vexcel** REST needs `X-API-KEY`; WKT is lon first: `POINT(-95.39 29.74)`. Other tools go through MCP (`data/vexcel.py` `VexcelMCP`); full tool list in `fixtures/vexcel_mcp_tools.json`.
- **Matterport auth** is HTTP Basic (API key : API token). The Showcase SDK key is separate (frontend 3D viewer, domain-locked to localhost).
- **3D overlays need the Bundle SDK**, not the embed SDK: only the bundle has `sdk.Scene` (Showcase's three.js scene). `viewer3d/` self-hosts it from `@matterport/webcomponent` (copied to `public/bundle` on `npm install`). Floor plan `(x, y)` = Showcase world `(x, floor, -y)`; Showcase `Room.data` ids equal floorplan `matterport_id`, which `viewer3d/src/frame.ts` uses to auto-calibrate.

## LLM and speech

- LLM is **Gemini** via `backend/agent/llm.py` `generate(prompt, system, json_schema)`. Main models are often overloaded, so it falls back through `gemini-3.5-flash` -> `3.5-flash-lite` -> `3.1-flash-lite`, 20 s max per model. Don't call the SDK directly; use the wrapper.
- **ElevenLabs** (`backend/dispatch/elevenlabs.py`): STT `scribe_v2` with speaker diarization; TTS `eleven_v3` (understands `emotion` tags like panicked). Voices by role, auto-picked from the account: dispatcher Daniel, caller Sarah, caller2 Adam, firefighter Harry (mayday radio), narrator Alice (spoken directions). Without TTS access, calls fall back to macOS `say`.
- **Call scripts** (`fixtures/calls/<id>/script.json`): each line has `role` (dispatcher | caller), optional `voice` (a role above) and `emotion`. Speakers in the audio get roles in the order they first appear in the script, so a single-speaker `"kind": "mayday"` call is the caller, not the dispatcher. After adding or editing a script, run `python -m scripts.process_calls <id>` (add `--refresh` to redo audio, transcript and timeline).

## Rules

- Never commit `.env` or keys. Never put the Matterport API key/token or Vexcel key in frontend code.
- Cache every external API response into `fixtures/` so the demo runs offline.
- No real 911 audio. Calls are scripted (`fixtures/calls/<id>/script.json`) and synthesized or acted out by the team.
- **Keep [docs/STATUS.md](docs/STATUS.md) current**: when you finish, start, or get blocked on something, update your role's section and add a changelog line, in the same commit.
