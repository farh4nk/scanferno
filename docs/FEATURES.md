# Features

Backlog of features for Scanferno (pitched as "SizeUp"): what's built, what's partial, and ideas we may pick up. Sections 1-7 are backend, 8 is the frontend. For live progress see [STATUS.md](STATUS.md); for data shapes see [CONTRACTS.md](CONTRACTS.md).

**Status key:** ✅ built · 🟡 partial · 💡 idea · ⛔ cut / out of scope
**Priority:** P0 must have for the demo · P1 nice to have · P2 only if time allows

Deadline: 8 am Sunday Nov 15. Anything not P0 should not block the demo.

## How features map to the demo

| Demo moment | Backend features it depends on |
|---|---|
| 20-second briefing | Dispatch pipeline (1.x), room locator (1.5), briefing agent (3.1), aerial annotations (4.3) |
| Maze score heatmap | Nav graph (2.1), egress analysis (2.2), maze score (2.3) |
| Mayday | Room locator (1.5), wall-following (2.4), mayday TTS (5.2) |
| Evacuation sim | Evac sim (2.6) |
| "Caller says the hallway is on fire" | Rerouting (2.8), briefing diff (3.4), caller corrections (1.7) |
| "Type any address" | Address search (7.1), geocoder fallback (7.2) |

---

## 1. Dispatch call pipeline (`backend/dispatch/`, owner: agent and data)

Turns a 911 call or radio dispatch into a structured record that reshapes the briefing as the caller talks.

| # | Feature | Status | Priority | Notes |
|---|---|---|---|---|
| 1.1 | Scripted calls (`fixtures/calls/<id>/script.json`) synthesized to audio | 🟡 | P0 | `vibe-1-clean`, `vibe-2-messy` done. `bellaire-1-patient`, `piney-1-storage`, `vibe-mayday` still need audio via `scripts.process_calls`. Real ElevenLabs voices blocked on key permission |
| 1.2 | Speech to text with speaker separation (ElevenLabs `scribe_v2`) | ✅ | P0 | `POST /dispatch/transcribe` |
| 1.3 | LLM fact extraction into the dispatch record, with confidence per field | ✅ | P0 | Gemini via `agent/llm.py`; rules fallback in `dispatch/facts.py` when Gemini is down |
| 1.4 | Live replay in call time (SSE: `utterance`, `record`, `briefing`, `mayday`) | ✅ | P0 | `GET /calls/{id}/replay`, `GET /calls/{id}/live` |
| 1.5 | Vague phrase to real room ("office by the elevators") | ✅ | P0 | `dispatch/locate.py`; uses room types, labels and distances. Known issue: "hallway" picks one of two hallways |
| 1.6 | Phrase to building side ("back of the building" -> Charlie side) | ✅ | P0 | Uses `geometry/sides.py` |
| 1.7 | Caller corrections mid-call ("no wait, it's the kitchen") | ✅ | P0 | `dispatch/history.py`: live records carry `corrections` {field: [{from, to, t}]}; the UI strikes through the old value. List fields only count as corrected when an item disappears |
| 1.8 | Typed-text fallback if audio fails during judging | ✅ | P0 | `POST /dispatch/extract`, `POST /buildings/{id}/dispatch` |
| 1.9 | Merge multiple callers into one picture | 💡 | P1 | Merge records by field; agreement raises confidence, conflicts get flagged instead of overwritten. Needs a second call script for the same incident |
| 1.10 | Live microphone streaming | 💡 | P1 | Chunk mic audio to STT every few seconds and reuse the replay event stream. Recorded calls are enough for the demo |
| 1.11 | Faster extraction | 💡 | P1 | Flash-lite takes 3 to 12 s per update. Options: only re-extract on new caller turns, run rules first and refine with Gemini, cache by transcript hash |
| 1.12 | Caller location and "people accounted for" fields | 💡 | P2 | "I'm outside in the parking lot", "everyone else got out"; lowers search priority for cleared rooms |

## 2. Geometry and navigation (`backend/geometry/`, owner: geometry)

The core technical depth: turning raw Matterport geometry into decisions.

| # | Feature | Status | Priority | Notes |
|---|---|---|---|---|
| 2.1 | Navigation graph of rooms and doorways, door width as capacity | ✅ | P0 | `navgraph.py`, `floorplan.py` -> `fixtures/<id>/floorplan.json` |
| 2.2 | Egress analysis: shortest path from every room to every exit, dead ends | ✅ | P0 | `egress.py`, `GET /buildings/{id}/routes` |
| 2.3 | Maze score (disorientation index) per room with reasons | ✅ | P0 | Path length, turns, branching, dead ends. Served in `/floorplan` as `maze_score` + `maze_detail` |
| 2.4 | Wall-following mayday directions (hand choice, doors passed, distance) | ✅ | P0 | `wallfollow.py`, `GET /buildings/{id}/mayday` |
| 2.5 | Fireground sides A-D per room, door and window | ✅ | P0 | Set by hand per building in `buildings.json` |
| 2.6 | Evacuation sim: clear time, bottleneck door, animation frames | ✅ | P1 | `evac.py`, `GET /buildings/{id}/evac` |
| 2.7 | Evac recommendations: which exit to prop open, where to stage crews | 🟡 | P1 | Bottleneck is detected; add "what if" reruns (block a door, prop an exit) and return the best option |
| 2.8 | Blocked-path rerouting: avoid the fire room / smoke-filled side | ✅ | P1 | `NavGraph.to_exit(avoid=...)` adds a 1000 m penalty per avoided room, so it only crosses fire when there is no other way (`through_avoided`). `GET /routes?avoid=`; briefing `exit_routes` avoid `fire_room_ids` and carry `rerouted`. Next: avoid a whole side ("smoke on Bravo") |
| 2.9 | Search plan ordering for the fire floor | 🟡 | P0 | Trapped person's room first, then rooms near fire, then by maze score. Check it reorders when a new fact arrives |
| 2.10 | Exits inferred from aerials for Piney Point and Bellaire | 🟡 | P0 | Currently hand overrides in `buildings.json`; scans have no exterior doorways |
| 2.11 | Indoor to aerial alignment (rotation, scale, offset) | 🟡 | P1 | Manual per hero building via `scan_rotation_deg`. Automatic fit of scan outline to Vexcel footprint is a stretch |
| 2.12 | Hose stretch / distance from entry to fire room | ✅ | P2 | `briefing.hose_stretch()`: interior path + 15 m apparatus setback per exterior door, against a 200 ft preconnect; hazard when none reach. `GET /buildings/{id}/hose?to_room=`, briefing `hose_stretch` |
| 2.13 | Side-wide smoke avoidance | 💡 | P1 | Extend 2.8: avoid every room on the side the caller names ("smoke coming from the left side") |
| 2.14 | Evac what-if: block a door | 💡 | P1 | Rerun `evac.simulate` with one exit removed; compare clear times. Pairs with 2.7 |

## 3. Agent (`backend/agent/`, owner: agent and data)

| # | Feature | Status | Priority | Notes |
|---|---|---|---|---|
| 3.1 | Briefing from all three layers + dispatch | ✅ | P0 | `POST /buildings/{id}/briefing`; hazards, entry points, search plan, exits |
| 3.2 | Commander Q&A grounded in data ("nearest exit from room 304?") | ✅ | P0 | `POST /buildings/{id}/ask`; Gemini tool calling, rules fallback; returns a highlight for the map |
| 3.3 | Every briefing claim cites its source layer | ✅ | P0 | Hazards carry `source`; entry points, ladders, search plan, exit routes and hose stretch carry `sources` [costar, vexcel, matterport, dispatch]. UI shows colored tags. Backs the "all three layers depend on each other" judging criterion |
| 3.4 | Incremental briefing updates (diff, not full rebuild) | 🟡 | P1 | `agent/changes.py`: each live `briefing` event carries `changes` (fire area, new trapped, search-first room, reroutes, new hazards) shown as a "Changed" box. The full briefing is still rebuilt and sent each time |
| 3.5 | Agent plan trace | 💡 | P1 | Expose the steps the agent took (tools called, data pulled) as an event stream. Backs the "true agent that plans and acts" criterion |
| 3.6 | Fire load from room types and tenant types | 🟡 | P1 | Kitchens, storage, print shops, chemical suppliers raise hazard level; combine Matterport room type with CoStar tenant |
| 3.7 | Vacancy and building age risk flags | 🟡 | P1 | CoStar vacancy and year built; vacant buildings appear repeatedly in NIOSH fatality reports |
| 3.8 | Large enclosed building flag | 🟡 | P1 | Footprint area from Vexcel above a threshold -> disorientation warning |
| 3.9 | Honest confidence and staleness notes | 💡 | P1 | Show data age (scan date, imagery date) and low-confidence facts in the briefing. Supports the honesty slide |
| 3.10 | LangChain deepagents version of the agent | 💡 | P2 | Only for the LangChain track; don't rewrite working code for it before the demo is locked |

## 4. Data layers (`backend/data/`, owner: agent and data)

| # | Feature | Status | Priority | Notes |
|---|---|---|---|---|
| 4.1 | CoStar building facts and tenants, enums decoded | ✅ | P0 | `data/costar.py`; many tenants are "Unknown tenant" |
| 4.2 | Vexcel roof material/condition, footprint, elevation, oblique images | ✅ | P0 | Cached under `fixtures/<id>/vexcel/` |
| 4.3 | Aerial annotations: entry points, roof access, ladder spots on oblique images | 💡 | P0 | Project known exits and sides onto the four obliques; return pixel boxes for the UI to draw |
| 4.4 | Vision model on obliques: doors, fire escapes, roof access | 💡 | P1 | Gemini vision on each oblique, cross-checked against Vexcel attributes and our exits. Could also confirm the inferred exits in 2.10 |
| 4.5 | Aerial ladder reach suggestions | 💡 | P1 | Roof height from elevation data vs typical ladder reach; suggest which side to position the truck |
| 4.6 | Roof collapse risk | 🟡 | P1 | Roof material + condition + building age -> "avoid roof ops" flag |
| 4.7 | Solar panel hazard | ⛔ | — | No hero building has solar; keep the check in code but don't demo it |
| 4.8 | Everything cached in `fixtures/` for offline demo | ✅ | P0 | Rule: any new external call must cache its response |

## 5. Audio out and delivery (owner: agent and data)

| # | Feature | Status | Priority | Notes |
|---|---|---|---|---|
| 5.1 | TTS for scripted call voices | 🟡 | P0 | ElevenLabs once voice ids work; macOS `say` fallback |
| 5.2 | Mayday directions spoken aloud | 💡 | P0 | TTS of `directions` from `/mayday`; short radio-style phrases, cached per room |
| 5.3 | Briefing as a 30-second radio summary | 💡 | P2 | Condensed spoken version of the briefing for crews en route |
| 5.4 | Printable one-page pre-plan (PDF) | 💡 | P2 | Same briefing data as a classic pre-plan sheet; shows we replace the binder |

## 6. Reliability for judging

| # | Feature | Status | Priority | Notes |
|---|---|---|---|---|
| 6.1 | Full offline mode (no keys, cached data only) | ✅ | P0 | All three heroes and calls served from `fixtures/` |
| 6.2 | Gemini fallback chain + rules fallback | ✅ | P0 | `agent/llm.py` |
| 6.3 | Cached briefing per call so the demo never waits on an LLM | 💡 | P0 | Precompute briefings for each scripted call record and serve them on replay; live LLM only for Q&A |
| 6.4 | Tests for API, dispatch and geometry | ✅ | P0 | 41 tests in `backend/tests`; add one per new endpoint |

## 7. Address search and property directory (`backend/data/directory.py`, `app/routers/search.py`)

| # | Feature | Status | Priority | Notes |
|---|---|---|---|---|
| 7.1 | Search buildings by address or name | ✅ | P0 | `GET /search?q=`. Offline over the 3 hero buildings (`status: ready`, full briefing) and 97 scanned CoStar properties from `hero_candidates.json` (`status: scanned`, facts only). Abbreviations normalized ("Freeway" = "Fwy"); a wrong house number on the right street is a weak match |
| 7.2 | Unknown address -> nearest known buildings | ✅ | P1 | `GET /search?q=&geocode=true` geocodes with OpenStreetMap Nominatim (no key) only when nothing matches well; cached in `fixtures/geocode/` |
| 7.3 | Property card for scanned-only buildings | ✅ | P1 | `GET /properties/{id or costar id}`: facts, scan stats, nearest buildings with a briefing, how to onboard |
| 7.4 | Onboard a searched property | 💡 | P2 | Promote a `scanned` property into `buildings.json` and run `scripts.fetch_fixtures` from the API. Needs Matterport/Vexcel keys and the CoStar kit, plus a hand-set `front` |
| 7.5 | Dispatch address drives the building | 💡 | P1 | When the live record's `address` arrives, run it through `/search` and confirm or switch the open building |
| 7.6 | Search by location | 🟡 | P2 | `GET /search?lat=&lon=` returns nearest buildings; no map picker in the UI yet |

## 8. Frontend (`frontend/`, owner: visuals and pitch)

| # | Feature | Status | Priority | Notes |
|---|---|---|---|---|
| 8.1 | Live call view (transcript, dispatch record, briefing from `/calls/{id}/live`) | ✅ | P0 | `hooks/useLiveCall.js` |
| 8.2 | SVG floor plan: maze heat, search order, trapped, fire, routes, sides | ✅ | P0 | Routes come from the briefing first, so reroutes around the fire show up |
| 8.3 | 3D model tab with overlays | ✅ | P1 | `components/Viewer3D.jsx` imports `viewer3d/src` |
| 8.4 | Header address search | ✅ | P0 | `components/search/AddressSearch.jsx`: debounced, keyboard nav, `/` to focus, Enter geocodes unknown addresses. Open building is kept in the URL (`?building=`) |
| 8.5 | Source tags, "Changed" box, hose stretch, struck-through caller corrections | ✅ | P0 | `SourceTags.jsx`, `BriefingPanel.jsx`, `DispatchPanel.jsx` |
| 8.6 | Mayday panel (wall path + browser TTS), evac sim, Ask-the-plan | ✅ | P1 | |
| 8.7 | Fire-aware route on room click | 💡 | P1 | Call `getRoute(id, room, fireRooms)` instead of the static plan route when a fire is known |
| 8.8 | Aerial annotations on obliques | 💡 | P1 | Needs 4.3 |
| 8.9 | Evac bottleneck door marked on the plan | 💡 | P2 | |

---

## Adding a feature end to end

1. Backend logic in the owning module (`geometry/`, `agent/`, `dispatch/`, `data/`), endpoint in the matching `backend/app/routers/*.py` (shared lookups in `app/deps.py`), test in `backend/tests/`.
2. One function per endpoint in `frontend/src/api/index.js`, grouped like the routers. Components never call `fetch` directly.
3. Data that several panels need goes in a hook under `frontend/src/hooks/`; components stay presentational.
4. New fields in `briefing.json` or a record: add them to [CONTRACTS.md](CONTRACTS.md).

---

## Open questions

- Do we demo a second hero building, or keep the whole demo on Vibe Hobby (`costar-239873`), which has real room types?
- Multi-caller merge (1.9): worth a scripted second call, or leave it as a slide?
- Do we have a firefighter quote to validate which briefing fields matter most?

## Adding a feature

Add a row to the right section with status 💡 and a priority. When you start it, move it to 🟡 and note it in STATUS.md; when it lands, mark ✅ and add the endpoint or module.
