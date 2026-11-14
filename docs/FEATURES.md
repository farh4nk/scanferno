# Backend features

Backlog of backend features for Scanferno (pitched as "SizeUp"): what's built, what's partial, and ideas we may pick up. Frontend and pitch work live elsewhere. For live progress see [STATUS.md](STATUS.md); for data shapes see [CONTRACTS.md](CONTRACTS.md).

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
| 1.7 | Caller corrections mid-call ("no wait, it's the kitchen") | 🟡 | P0 | Messy call works; add explicit "superseded" history per field so the UI can show the change |
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
| 2.8 | Blocked-path rerouting: avoid the fire room / smoke-filled side | 💡 | P1 | Take the dispatch fire location, raise edge cost near it, return the next-best route. Strong demo line: "route changes when the caller says the hallway is on fire" |
| 2.9 | Search plan ordering for the fire floor | 🟡 | P0 | Trapped person's room first, then rooms near fire, then by maze score. Check it reorders when a new fact arrives |
| 2.10 | Exits inferred from aerials for Piney Point and Bellaire | 🟡 | P0 | Currently hand overrides in `buildings.json`; scans have no exterior doorways |
| 2.11 | Indoor to aerial alignment (rotation, scale, offset) | 🟡 | P1 | Manual per hero building via `scan_rotation_deg`. Automatic fit of scan outline to Vexcel footprint is a stretch |
| 2.12 | Hose stretch / distance from entry to fire room | 💡 | P2 | Path length from each entry door to the fire room; flags when it exceeds a standard 200 ft preconnect |

## 3. Agent (`backend/agent/`, owner: agent and data)

| # | Feature | Status | Priority | Notes |
|---|---|---|---|---|
| 3.1 | Briefing from all three layers + dispatch | ✅ | P0 | `POST /buildings/{id}/briefing`; hazards, entry points, search plan, exits |
| 3.2 | Commander Q&A grounded in data ("nearest exit from room 304?") | ✅ | P0 | `POST /buildings/{id}/ask`; Gemini tool calling, rules fallback; returns a highlight for the map |
| 3.3 | Every briefing claim cites its source layer | 💡 | P0 | Tag each hazard/recommendation with `source` (costar, vexcel, matterport or dispatch). Directly backs the "all three layers depend on each other" judging criterion |
| 3.4 | Incremental briefing updates (diff, not full rebuild) | 💡 | P1 | Return what changed since the last record so the UI can animate only the changed parts and the timer stays low |
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
| 6.4 | Tests for API, dispatch and geometry | ✅ | P0 | 28 tests in `backend/tests`; add one per new endpoint |

---

## Open questions

- Do we demo a second hero building, or keep the whole demo on Vibe Hobby (`costar-239873`), which has real room types?
- Multi-caller merge (1.9): worth a scripted second call, or leave it as a slide?
- Do we have a firefighter quote to validate which briefing fields matter most?

## Adding a feature

Add a row to the right section with status 💡 and a priority. When you start it, move it to 🟡 and note it in STATUS.md; when it lands, mark ✅ and add the endpoint or module.
