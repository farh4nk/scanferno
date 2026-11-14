# Status

Living handoff doc. Update your role's section and add a changelog line in the same commit as your work.

## Agent and data (branch `agent-data`)

**Done**
- Access to all sources verified: CoStar kit, Matterport GraphQL, Vexcel REST + MCP, Gemini, ElevenLabs STT (`scripts/check_access`).
- 3 hero buildings picked by verified scan quality; all data cached in `fixtures/` (`scripts/pick_heroes`, `scripts/fetch_fixtures`).
- Dispatch pipeline: audio -> diarized transcript -> live dispatch records via Gemini, with deterministic room matching (`dispatch/`). Two Vibe Hobby calls processed: `vibe-1-clean`, `vibe-2-messy`.
- API: buildings, calls, SSE replay, typed extract, transcribe, static fixtures (`app/main.py`).

**Next**
1. Regenerate call audio with real ElevenLabs voices (waiting on Voices: Read for the key).
2. ~~Briefing agent~~ done on `geometry-agent`: `POST /buildings/{id}/briefing` (`agent/briefing.py`).
3. ~~Commander Q&A~~ done on `geometry-agent`: `POST /buildings/{id}/ask` (`agent/ask.py`, Gemini tool calling, rules fallback).
4. Mayday TTS: speak the `directions` from `GET /buildings/{id}/mayday` (or the `mayday` event on `/calls/{id}/live`).

**Open issues**
- Gemini main models overloaded; extraction runs on flash-lite, 3 to 12 s per update. Replay of cached calls hides this.
- Messy call: the "hallway" match picks one of two scanned hallways.


## Rescue plan / audio analysis (branch `audio-analysis`)

**Done**
- Fire heat field (`geometry/heat.py`) and per-person rescue plan (`agent/rescue.py`).
- Live wire-up (`agent/live_geometry.py`): nest `heat` + `rescue` on live/SSE briefings; CoStar/Vexcel/maze risk modifiers; address `building_match` + session rebind; `POST .../tick`.
- Frontend: danger zones + person markers + in/out routes on Rescue; Walk rescue on 3D; spoken address auto-opens a ready building.

**Next**
1. Multi-floor heat.
2. Richer 3D heat raster if needed.

## On-demand ready (branch `ondemand`)

**Done**
- `backend/ondemand/`: `prepare(key)` fetches Matterport vector, registers the building, builds floorplan (same layout as heroes). Registry in `fixtures/ondemand/ready.json`.
- API: `GET/POST /ondemand/{key}`. `layers.building` and `GET /buildings` include onboarded rows.
- Frontend: property card "Open briefing" onboards on demand (loading state), then opens floor plan / 3D.
- Live: when the dispatch record gets an address for another known building, the session onboards it and switches `building_id` (`building_changed`); UI follows without killing the call.

**Next**
1. Prefetch a shortlist (Houston commercial) overnight for zero-wait demos.
2. Better default `front` / exits when the scan has no exterior doorways.

## Geometry (branch `geometry-agent`)

**Done**
- `floorplan.json` for all 3 buildings (`geometry/floorplan.py`, cached in `fixtures/<id>/`): labeled rooms, doors with exits, windows, outline, fireground sides A-D per room/door/window.
- Nav graph + exit routes + maze score with reasons (`navgraph.py`, `egress.py`); `scripts/render_floorplan.py --maze` for a PNG.
- Mayday wall-following directions with hand choice and doors-passed count (`wallfollow.py`).
- Evac sim with bottleneck door (`evac.py`).
- Briefing (all 3 layers + dispatch) and commander Q&A (`agent/`); offline rule extractor + room locator as Gemini fallback (`dispatch/facts.py`, `dispatch/locate.py`).
- API: `/buildings/{id}` `/floorplan` `/routes` `/mayday` `/evac`, `POST /dispatch` `/briefing` `/ask`, and `/calls/{id}/live` (replay + briefing + mayday events). 28 tests in `backend/tests`.

**Open issues**
- Piney Point and Bellaire exits are inferred from aerials (`floorplan_overrides` in buildings.json); scan has no exterior doorways.
- New scripts `bellaire-1-patient`, `piney-1-storage`, `vibe-mayday` have no audio yet: run `scripts.process_calls`.

## Visuals and pitch (branch `ui`)

**Redesign (branch `ui-guide-sign`): the real `frontend/` now uses the new UI**
- "Guide Sign" world, fire palette (charcoal, fire orange, ember red only for life risk). Product brief in `PRODUCT.md`; clickable mock in `.impeccable/mocks/prototype.html`.
- Home (`src/brief/Home.jsx`) is the briefing: 5 key-fact signs with pictograms, floor plan with the plan of attack drawn on it, 4 steps Arrive / Enter / Search / Get out with diagrams (building section, hose gauge, distance scale, search path, exit bars), Play (browser TTS + caption) or Read. Live/replayed calls reshape it as facts arrive.
- All spoken output is ElevenLabs via `POST /speech`: the `briefing` voice (Bill, picked by ear; `eleven_flash_v2_5`, speed 1.2 plus 1.1x playback, low stability) reads a dispatch-style script ("Fire, Charlie side, third floor. Caution: oxygen cylinders. Egress: 8 meters, Alpha side."), generated in the background once the briefing settles so Play starts at once ( word-timed captions, cached in `fixtures/tts/`); the browser voice is gone. The briefing steps are fetched one at a time, current step first; the backend allows 2 ElevenLabs requests at once and retries 429s (`ELEVENLABS_CONCURRENCY`).
- Calls replay from `GET /calls/{id}/frames` (`src/hooks/useCallPlayer.js`) with a transport bar under the top strip (`src/brief/CallBar.jsx`): play/pause, previous/next fact, scrub bar with Fire / Trapped / Hazard markers, 1–2× speed, Space and arrow keys. Click a transcript line to jump there. The spoken briefing can skip steps (⏮ ⏭, or click a step while it plays).
- During a call the home plan goes live: everything known so far is drawn at once, rooms named in each update flash, and a NEW banner quotes the change (from the stream's `changes`). Clicking a step takes over; when the call ends it lands on Search.
- 3D model is first-class: a 2D/3D switch on the home plan (briefing overlays follow the step) and a `#model` page, first in the toolbar.
- One page per job behind `#hash` routes (`src/pages/Pages.jsx`): 3D model, Call (replay + live mic), Dispatch facts, Rescue, Entry, Hazards, Hose, Exterior, Aerial, Floor plan (2D + 3D), Mayday (steps + speak), Evacuation, Ask, All tools.
- Shared pieces: `src/brief/model.js` (derives the briefing facts from floorplan + briefing + record, no building-specific code), `src/brief/PlanSvg.jsx` (one plan renderer), `src/brief/Diagrams.jsx`, `src/ui/Icon.jsx`.
- Removed the old panels (Briefing, Dispatch, Transcript, Mayday, Evac, Ask, Aerial, FloorPlan, SourceTags); kept AddressSearch, PropertyCard, LivePanel, Viewer3D.
- Next: wire the rescue planner (`agent/rescue.py`) into the Search step once it has an endpoint; check the 3D tab with a Matterport SDK key.

**Done**
- React + Vite app in `frontend/` (`npm install && npm run dev`, http://localhost:5173; backend URL via `VITE_API_URL`, default http://localhost:8000).
- Live call view: SSE `/calls/{id}/live` drives transcript, dispatch record (changed fields flash), briefing, mayday; audio starts when the stream opens.
- SVG floor plan: maze heat, search order, trapped marker, fire area, exit routes, doors/windows, sides A-D, room click shows route + maze reasons.
- Briefing tabs, Vexcel aerial viewer, Ask-the-plan (highlights answer on the plan), mayday panel (wall path + browser TTS), evac sim animation.

**Next**
1. Visual polish and pitch flow; Matterport 3D viewer (needs `MATTERPORT_SDK_KEY`).
2. Indoor-to-aerial overlay; mark evac bottleneck door on the plan.

**Unblocked by:** aerial images at `/fixtures/<id>/vexcel/*.jpg`, calls at `/calls/{id}` and `/calls/{id}/replay` (SSE), sample briefing at `fixtures/sample/briefing.json`.

## Changelog
- 2026-11-14: Ion 3D hang fix: reuse floorplan.json, skip ondemand rebuild on cache hit, mark onboarded buildings ready in search.

- 2026-11-14: Repo scaffold, data clients, contracts.
- 2026-11-14: CoStar kit loader, hero picker, Gemini wrapper.
- 2026-11-14: Hero buildings verified, Matterport/Vexcel/CoStar data cached.
- 2026-11-14: Gemini fallback chain; Deepgram dropped.
- 2026-11-14: Dispatch pipeline, two scripted calls, call API with SSE replay.
- 2026-11-14: AGENTS.md / CLAUDE.md / STATUS.md for teammates' agents.
- 2026-11-14: Geometry (floorplan, routes, maze, mayday, evac, sides), briefing + Q&A agents, live call stream.
- 2026-11-14: Frontend scaffold: live call, floor plan, briefing, aerials, Q&A, mayday, evac (React + Vite).
- 2026-11-14: Frontend 3D model tab using viewer3d overlays.
- 2026-11-14: Address search (`/search`, `/properties`, header search UI); backend routers + frontend `api/` and `hooks/` restructure; fire rerouting, hose stretch, briefing sources, live `changes` and caller `corrections`; FEATURES.md covers frontend + search (41 tests).
- 2026-11-14: Live call transcription: `/live/sessions` (mic via ElevenLabs, browser speech, typed lines, uploads), save live calls as replayable fixtures, frontend Live mode (47 tests).
- 2026-11-14: 3D walk mode: click a room to fly into it; exit route follows the camera, visible through walls, with a turn arrow (branch `walk-route`).
- 2026-11-14: All 5 calls re-voiced with ElevenLabs; speaker roles follow script order (fixes single-speaker mayday call); `--refresh` now re-transcribes too.
- 2026-11-14: Search over all 14,946 Matterport models (~8,500 buildings) with SQLite FTS5 index, CoStar join, on-demand cached Vexcel roof + aerial per building; `/search/stats`, `/properties/{id}/vexcel`, `/properties/{id}/aerial` (51 tests).
- 2026-11-14: Search filters (status, city, kind, CoStar) with facet counts, paging, infinite-scroll dropdown; city typos folded (52 tests).
- 2026-11-14: Rescue plan heat field + per-person in/out routes (`geometry/heat.py`, `agent/rescue.py`); cached Vexcel for several searched properties.
- 2026-11-14: UI redesign prototype (Guide Sign, briefing-first home with diagrams, spoken/read briefing) in `.impeccable/mocks/prototype.html`; `PRODUCT.md` product brief (branch `ui-redesign-prototype`).
- 2026-11-14: Frontend redesign landed (branch `ui-guide-sign`): briefing-first home with key-fact signs, plan of attack and diagrams; one page per tool; fire palette.
- 2026-11-14: 3D model back up front: 2D/3D switch on the home briefing plan, `#model` page first in the toolbar.
- 2026-11-14: Live call highlights back on the 2D plan: live mode, flashing rooms per update, NEW banner, key signs flash on change.
- 2026-11-14: Seekable calls: `GET /calls/{id}/frames` + call transport bar (scrub, skip to next fact, speed); skip steps in the spoken briefing (54 tests).
- 2026-11-14: ElevenLabs voice for the spoken briefing and mayday steps (`POST /speech`, word-timed captions, cached); Office 110 mayday lines pre-generated (55 tests).
- 2026-11-14: Briefing voice: Bill on ElevenLabs flash at max speed, dispatch radio script with phonetic sides, background pre-generation so Play is instant.
- 2026-11-14: Live audio → briefing heat/rescue + address auto-switch + 3D Walk enter/exit (branch `audio-analysis`).
- 2026-11-14: On-demand ready (`backend/ondemand/`): POST /ondemand/{key}, property-card open, live address→building switch.
