# Status

Living handoff doc. Update your role's section and add a changelog line in the same commit as your work.

## Agent and data (branch `agent-data`)

**Done**
- Access to all sources verified: CoStar kit, Matterport GraphQL, Vexcel REST + MCP, Gemini, ElevenLabs STT (`scripts/check_access`).
- 3 hero buildings picked by verified scan quality; all data cached in `fixtures/` (`scripts/pick_heroes`, `scripts/fetch_fixtures`).
- Dispatch pipeline: audio -> diarized transcript -> live dispatch records via Gemini, with deterministic room matching (`dispatch/`).
- All 5 calls voiced with ElevenLabs (eleven_v3, emotion tags) and processed: `vibe-1-clean`, `vibe-2-messy`, `bellaire-1-patient`, `piney-1-storage`, `vibe-mayday`. Mayday call verified on `/calls/vibe-mayday/live` (emits the `mayday` event).
- API: buildings, calls, SSE replay, typed extract, transcribe, static fixtures. Split into `app/routers/` (buildings, calls, dispatch, search) with shared lookups in `app/deps.py`; paths unchanged.
- Address search: `GET /search` over 3 hero + 97 scanned CoStar properties, with a cached OpenStreetMap geocoder fallback; `GET /properties/{id}` (`data/directory.py`).
- Briefing: every claim carries `sources`; exit routes avoid the fire area (`rerouted`, `through_avoided`); `hose_stretch` vs a 200 ft preconnect (`GET /buildings/{id}/hose`).
- Live stream: briefing `changes` since the last update (`agent/changes.py`), record `corrections` for what the caller changed (`dispatch/history.py`).
- Live transcription: `/live/sessions` (`dispatch/session.py`, `app/routers/live.py`) takes mic audio (ElevenLabs STT, re-transcribed whole each upload) or ready-made lines (browser speech / typed), re-extracts when caller lines change, returns record + briefing + mayday, and can save the call as `fixtures/calls/live-<id>/`. `/health` reports `stt`; without a key audio endpoints return 503.

**Next**
1. ~~Regenerate call audio with real ElevenLabs voices~~ done.
2. ~~Briefing agent~~ done on `geometry-agent`: `POST /buildings/{id}/briefing` (`agent/briefing.py`).
3. ~~Commander Q&A~~ done on `geometry-agent`: `POST /buildings/{id}/ask` (`agent/ask.py`, Gemini tool calling, rules fallback).
4. Mayday TTS: speak the `directions` from `GET /buildings/{id}/mayday` (or the `mayday` event on `/calls/{id}/live`).

**Open issues**
- Server mic transcription only tested with a stubbed STT so far (ElevenLabs key works on the Mac; needs a real run).
- Gemini main models overloaded; extraction runs on flash-lite, 3 to 12 s per update. Replay of cached calls hides this.
- Messy call: the "hallway" match picks one of two scanned hallways.

## Rescue plan / audio analysis (branch `audio-analysis`)

**Done**
- Fire heat field (`geometry/heat.py`) and per-person rescue plan (`agent/rescue.py`): place trapped people from the call, risk-weighted way in / way out (doors + exterior windows as breach options).
- Live wire-up (`agent/live_geometry.py`): nest `heat` + `rescue` on live session + `/calls/{id}/live` briefings; CoStar/Vexcel/maze risk modifiers; address → `building_match` + session rebind; quiet `POST .../tick`.
- Frontend: danger zones + person markers + in/out routes on Rescue 2D; Walk rescue on 3D (enter → victim → exit); spoken address auto-opens a ready building.

**Next**
1. Multi-floor heat.
2. Richer 3D heat raster if needed.

## Search (branch `search`)

**Done**
- Search covers every Matterport model our key can see: 14,946 models grouped into ~8,500 buildings (~5,700 with a location, mostly Houston and LA). `scripts/sync_catalog.py` pages the Model API (~20 s), groups scans by street address + ZIP (merges spelling variants like "1027 Wiltshire Blvd", folds amenity scans into the building within 60 m), names complexes from unit titles ("Skylux on Wilshire"), joins CoStar, writes `fixtures/catalog/*.json.gz` (offline).
- Index: in-memory SQLite FTS5 (prefix + typo-expanded tokens) picks candidates, `score()` ranks; also matches unit/scan names, tenants and room labels (`match: "extra"`). 2-100 ms per query.
- `GET /properties/{id}` accepts building id, CoStar id or any Matterport model id; returns all scans, CoStar facts, cached Vexcel. `GET /properties/{id}/vexcel` and `/aerial?view=` fetch Vexcel on first open (~1 s) and cache under `fixtures/catalog/vexcel/`. `GET /search/stats`.
- Property card shows aerial, roof/footprint, CoStar facts and tenants, and a list of Matterport scans.
- Filtered search: `/search` takes `status`, `city`, `kind` (commercial/residential/other, from CoStar type or scan names), `costar`, `offset`; returns `total` and `facets` (counts per filter value). Scored matches and facets are cached per query, so paging and filter toggles take ~10-40 ms. Header dropdown has live filter chips with counts and infinite scroll.

**Next**
1. Unzip the CoStar kit (password-protected zip) and re-run `python -m scripts.sync_catalog --offline`: links every scanned property in `commercial-properties.csv` to CoStar facts/tenants (now only the 100 cached candidates are linked).
2. One-click onboarding: turn a scanned building into a "ready" briefing (vector data + Vexcel + CoStar fetch, like `fetch_fixtures`).
3. 3D viewer for any scanned model (viewer3d takes a model id), not just heroes.

**Open issues**
- ~2,800 scans have no address or location (amenity scans like "Pool"); searchable by name only.

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
- ~~New scripts have no audio yet~~ all voiced and processed (agent-data).

## 3D model overlays (branch `matterport-3d`, folder `viewer3d/`)

Framework-free TypeScript toolkit that draws our data on the Matterport model, plus a bare dev bench (`npm run dev`) to test layers and tune alignment. Not the product UI: the website imports `viewer3d/src` later.

**Done**
- Self-hosted Showcase **Bundle SDK** (`@matterport/webcomponent`, copied to `public/bundle` on install); all 3 hero models load with the SDK key on localhost (`showcase.ts`).
- Auto-calibration floor plan -> world by matching Showcase `Room.data` ids to `matterport_id` (`frame.ts`): Vibe 8 rooms / 0.05 m RMS, Bellaire 22 / 0.12 m, Piney Point 11 / 0.17 m. Hand overrides in `calibrations.ts`; the dev bench has nudge inputs + "Copy JSON".
- Overlay layers in Showcase's three.js scene, in floor plan meters (`overlay.ts`): `polygon`, `volume`, `path`, `marker`, `label`, instanced `dots`, per-frame `tick`. Named layers, independent clear/hide.
- Click picking -> floor plan point + room via `Renderer.getWorldPositionData` on the floor plane (`picking.ts`); 16/16 Vibe rooms resolve correctly.
- Ready drawers (`draw/`): rooms by type or maze score, labels, outline, doors, exits (inferred marked), exterior windows, room highlight (pulsing), route to exit with flow dots, mayday wall path with walker, evac sim player (interpolated occupants, door queue discs, bottleneck ring; play/pause/seek/speed).
- `openBuilding(el, building, {sdkKey})` wires it all: mount, calibrate, overlay, picking.
- Walk mode (`walk.ts`): `walkTo(roomId)` flies to the best sweep in a room (Matterport room tag, then inside the polygon, then nearest; Office 110 has none inside) facing its way out; `onMove`/`onHeading` follow the camera. In the website, picking a room anywhere flies into it, and in Walk the exit route is redrawn from the room you stand in, x-rayed through walls with an exit beacon and a turn arrow in the bar.

**Next**
1. Integration branch: import `viewer3d/src` into the website, feed it `/calls/{id}/live` events (briefing search plan -> `highlightRooms`, `mayday` event -> `drawMayday`).
2. Fire / victim / crew markers and a smoke-spread layer once the backend emits them.

**Open issues**
- Bellaire refuses `Mode.moveTo(dollhouse)` right after load (stays inside); overlays still render inside. Piney Point has no floor plan view.
- Geometry: `floorplan.py` keeps only the largest piece of multi-part rooms (Bellaire Open area B is 9x17 m vs 18x21 m in Showcase; Offices 101, 111, 113 too). Calibration ignores those rooms.

## Visuals and pitch (branch `ui`)

**Redesign (branch `ui-guide-sign`): the real `frontend/` now uses the new UI**
- "Guide Sign" world, fire palette (charcoal, fire orange, ember red only for life risk). Product brief in `PRODUCT.md`; clickable mock in `.impeccable/mocks/prototype.html`.
- Home (`src/brief/Home.jsx`) is the briefing: 5 key-fact signs with pictograms, floor plan with the plan of attack drawn on it, 4 steps Arrive / Enter / Search / Get out with diagrams (building section, hose gauge, distance scale, search path, exit bars), Play (browser TTS + caption) or Read. Live/replayed calls reshape it as facts arrive.
- 3D model is first-class: a 2D/3D switch on the home plan (briefing overlays follow the step) and a `#model` page, first in the toolbar.
- One page per job behind `#hash` routes (`src/pages/Pages.jsx`): 3D model, Call (replay + live mic), Dispatch facts, Rescue, Entry, Hazards, Hose, Exterior, Aerial, Floor plan (2D + 3D), Mayday (steps + speak), Evacuation, Ask, All tools.
- Shared pieces: `src/brief/model.js` (derives the briefing facts from floorplan + briefing + record, no building-specific code), `src/brief/PlanSvg.jsx` (one plan renderer), `src/brief/Diagrams.jsx`, `src/ui/Icon.jsx`.
- Removed the old panels (Briefing, Dispatch, Transcript, Mayday, Evac, Ask, Aerial, FloorPlan, SourceTags); kept AddressSearch, PropertyCard, LivePanel, Viewer3D.
- Next: wire the rescue planner (`agent/rescue.py`) into the Search step once it has an endpoint; check the 3D tab with a Matterport SDK key.

**Done**
- React + Vite app in `frontend/` (`npm install && npm run dev`, http://localhost:5173; backend URL via `VITE_API_URL`, default http://localhost:8000).
- Live call view: SSE `/calls/{id}/live` drives transcript, dispatch record (changed fields flash), briefing, mayday; audio starts when the stream opens.
- SVG floor plan: maze heat, search order, trapped marker, fire area, exit routes, doors/windows, sides A-D, room click shows route + maze reasons.
- 3D tab: mounts `viewer3d/` (Matterport Bundle SDK) via Vite alias `@viewer3d`; draws maze rooms, exits, fire, trapped, search order, routes, mayday and evac in the model. Needs `MATTERPORT_SDK_KEY` in repo-root `.env`.
- Briefing tabs, Vexcel aerial viewer, Ask-the-plan (highlights answer on the plan), mayday panel (wall path + browser TTS), evac sim animation.
- Structure: `src/api/` (one function per endpoint, mirrors `backend/app/routers/`), `src/hooks/` (`useLiveCall`, `useBuildingData`, `useDebounced`), `src/components/search/`.
- Header address search replaces the building dropdown: matches known buildings, opens a property card for scanned-only ones, Enter geocodes unknown addresses; open building kept in `?building=`.
- Live mode (header Replay / Live): `LivePanel` with ElevenLabs mic, browser speech recognition (Chrome/Edge) or typed lines, recording upload, "First voice is the" / "Speaking as" role toggle, save as a replayable call.
- Source tags on briefing claims, "Changed" box in the summary, hose stretch in the Entry tab, struck-through caller corrections, floor plan draws rerouted exit routes.

**Next**
1. Visual polish and pitch flow; test the 3D tab with a real `MATTERPORT_SDK_KEY` (untested without a key).
2. Indoor-to-aerial overlay; mark evac bottleneck door on the plan.

**Unblocked by:** aerial images at `/fixtures/<id>/vexcel/*.jpg`, calls at `/calls/{id}` and `/calls/{id}/replay` (SSE), sample briefing at `fixtures/sample/briefing.json`.

## Changelog

- 2026-11-14: Repo scaffold, data clients, contracts.
- 2026-11-14: CoStar kit loader, hero picker, Gemini wrapper.
- 2026-11-14: Hero buildings verified, Matterport/Vexcel/CoStar data cached.
- 2026-11-14: Gemini fallback chain; Deepgram dropped.
- 2026-11-14: Dispatch pipeline, two scripted calls, call API with SSE replay.
- 2026-11-14: AGENTS.md / CLAUDE.md / STATUS.md for teammates' agents.
- 2026-11-14: Geometry (floorplan, routes, maze, mayday, evac, sides), briefing + Q&A agents, live call stream.
- 2026-11-14: `viewer3d/`: Matterport Bundle SDK viewer with auto-calibrated overlay layers (rooms, exits, routes, mayday, evac sim), picking, dev bench.
- 2026-11-14: docs/FEATURES.md backend feature backlog (built, partial, ideas, priorities).
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
- 2026-11-14: Live audio → briefing heat/rescue + address auto-switch + 3D Walk enter/exit (branch `audio-analysis`, 58 tests).
