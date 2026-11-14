# Status

Living handoff doc. Update your role's section and add a changelog line in the same commit as your work.

## Agent and data (branch `agent-data`)

**Done**
- Access to all sources verified: CoStar kit, Matterport GraphQL, Vexcel REST + MCP, Gemini, ElevenLabs STT (`scripts/check_access`).
- 3 hero buildings picked by verified scan quality; all data cached in `fixtures/` (`scripts/pick_heroes`, `scripts/fetch_fixtures`).
- Dispatch pipeline: audio -> diarized transcript -> live dispatch records via Gemini, with deterministic room matching (`dispatch/`).
- All 5 calls voiced with ElevenLabs (eleven_v3, emotion tags) and processed: `vibe-1-clean`, `vibe-2-messy`, `bellaire-1-patient`, `piney-1-storage`, `vibe-mayday`. Mayday call verified on `/calls/vibe-mayday/live` (emits the `mayday` event).
- API: buildings, calls, SSE replay, typed extract, transcribe, static fixtures (`app/main.py`).

**Next**
1. ~~Regenerate call audio with real ElevenLabs voices~~ done.
2. ~~Briefing agent~~ done on `geometry-agent`: `POST /buildings/{id}/briefing` (`agent/briefing.py`).
3. ~~Commander Q&A~~ done on `geometry-agent`: `POST /buildings/{id}/ask` (`agent/ask.py`, Gemini tool calling, rules fallback).
4. Mayday TTS: speak the `directions` from `GET /buildings/{id}/mayday` (or the `mayday` event on `/calls/{id}/live`).

**Open issues**
- Gemini main models overloaded; extraction runs on flash-lite, 3 to 12 s per update. Replay of cached calls hides this.
- Messy call: the "hallway" match picks one of two scanned hallways.

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

## Visuals and pitch (branch `ui`)

**Unblocked by:** aerial images at `/fixtures/<id>/vexcel/*.jpg`, calls at `/calls/{id}` and `/calls/{id}/replay` (SSE), sample briefing at `fixtures/sample/briefing.json`.

## Changelog

- 2026-11-14: Repo scaffold, data clients, contracts.
- 2026-11-14: CoStar kit loader, hero picker, Gemini wrapper.
- 2026-11-14: Hero buildings verified, Matterport/Vexcel/CoStar data cached.
- 2026-11-14: Gemini fallback chain; Deepgram dropped.
- 2026-11-14: Dispatch pipeline, two scripted calls, call API with SSE replay.
- 2026-11-14: AGENTS.md / CLAUDE.md / STATUS.md for teammates' agents.
- 2026-11-14: Geometry (floorplan, routes, maze, mayday, evac, sides), briefing + Q&A agents, live call stream.
- 2026-11-14: All 5 calls re-voiced with ElevenLabs; speaker roles follow script order (fixes single-speaker mayday call); `--refresh` now re-transcribes too.
