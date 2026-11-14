# Plan

Submission deadline: 8 am Sunday.

## Demo moments (build backward from these)

1. **20-second briefing.** Recorded dispatch call plays, transcript scrolls, a red marker drops on the trapped person's room, the search plan reorders, annotated aerials assemble.
2. **Maze score.** Floor plan heatmap of disorientation risk (far from exits, many turns, dead ends).
3. **Mayday.** "Crew last seen in storage room 2B" -> lit route plus wall-following directions.
4. **Evacuation sim** (nice to have). Occupant dots flow to exits and jam at narrow doors.

## Technical depth

1. Nav graph from Matterport room outlines and doors (door width = capacity)
2. Egress analysis: shortest paths, dead ends, disorientation index
3. Wall-following directions
4. Indoor to aerial alignment (manual for hero buildings is fine)
5. Vision on aerial images, cross-checked with Vexcel attributes
6. Crowd flow with standard egress rates

## Dispatch pipeline

audio -> streaming STT (Whisper / Deepgram / ElevenLabs) -> LLM fills structured record with confidence -> map phrases to rooms and building sides (A/B/C/D) -> update briefing.

Record shape:

```json
{
  "address": "1234 Westheimer Rd, Houston TX",
  "floor": 3,
  "side": "C",
  "conditions": ["black smoke"],
  "trapped": [{"description": "coworker", "near": "elevators", "floor": 3}],
  "hazards": ["possible gas leak"],
  "confidence": {"floor": 0.95, "trapped": 0.7}
}
```

## Team split

| Role | Owns |
|---|---|
| Geometry | Matterport -> nav graph, routes, maze score, wall-following |
| Agent and data | CoStar/Vexcel access, dispatch transcription + extraction, agent, briefing |
| Visuals and pitch | Aerial map, floor plan viz, live transcript view, animations, recorded calls, 2 min pitch + video |

## Pitch (2 min)

Hook 15s (Charleston) -> Problem 15s -> Demo 60s -> How it works 20s -> Close 10s: "Every building CoStar has mapped could have a pre-plan tomorrow."

Include one honesty slide: data can be stale, tool supports judgment, on-scene verification still matters.

## First 2 hours

- [ ] Everyone: clone, `.env`, run backend health check
- [ ] Pick 2-3 hero buildings (Houston or LA, good Matterport scans)
- [ ] Agent/data: confirm CoStar, Vexcel and Matterport access; cache one response each into `fixtures/`
- [ ] Geometry: load one Matterport floor plan into a graph
- [ ] Visuals: stub frontend with aerial map + floor plan panel
- [ ] Record one scripted dispatch call
