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
2. Briefing agent: combine costar.json + Vexcel structure data + Geometry's floorplan/routes + dispatch record -> `briefing.json` (shape in CONTRACTS.md), endpoint `GET /buildings/{id}/briefing`.
3. Commander Q&A endpoint ("nearest exit from room X?") grounded in the same data.
4. Mayday TTS: speak Geometry's wall-following directions.

**Open issues**
- Gemini main models overloaded; extraction runs on flash-lite, 3 to 12 s per update. Replay of cached calls hides this.
- Messy call: the "hallway" match picks one of two scanned hallways.

## Geometry (branch `geometry`)

**Unblocked by:** real floor plans in `fixtures/<id>/matterport_vector.json` (start with `costar-239873`). See the Matterport quirks in AGENTS.md.

**Needed by Agent and data:** `floorplan.json` per building and route/mayday functions (CONTRACTS.md sections 1 and 5).

## Visuals and pitch (branch `ui`)

**Unblocked by:** aerial images at `/fixtures/<id>/vexcel/*.jpg`, calls at `/calls/{id}` and `/calls/{id}/replay` (SSE), sample briefing at `fixtures/sample/briefing.json`.

## Changelog

- 2026-11-14: Repo scaffold, data clients, contracts.
- 2026-11-14: CoStar kit loader, hero picker, Gemini wrapper.
- 2026-11-14: Hero buildings verified, Matterport/Vexcel/CoStar data cached.
- 2026-11-14: Gemini fallback chain; Deepgram dropped.
- 2026-11-14: Dispatch pipeline, two scripted calls, call API with SSE replay.
- 2026-11-14: AGENTS.md / CLAUDE.md / STATUS.md for teammates' agents.
