# Scanferno

When a fire call comes in, Scanferno turns CoStar, Vexcel and Matterport data into a full building briefing for firefighters in seconds, including how to get every crew member back out.

HackPrinceton 2026. Tracks: Healthcare (main), CoStar, Amazon Practical AI, LangChain.

## Why

- 2007 Charleston furniture store fire: nine firefighters died, and the investigation cited an incomplete pre-fire plan that wasn't available on scene.
- Pre-plans are made by hand, kept in binders, and go out of date. Most buildings have none.

## What it does

1. **On dispatch:** transcribes a dispatch call, extracts structured facts (address, floor, side, trapped people, hazards), pulls all three data layers, and builds the briefing.
2. **During the incident:** the commander asks questions ("nearest exit from room 304?") and gets answers grounded in the data.
3. **In a mayday:** generates wall-following directions out for a lost crew.

| Layer | Source | Gives us |
|---|---|---|
| Outside | Vexcel | Angled aerial views, roof material/height, solar panels, footprint |
| Inside | Matterport | Floor plans, doors and widths, stairs, room types |
| Who's inside | CoStar | Tenant types, occupancy, building age, vacancy |

## Repo layout

Each person owns a folder, so merges stay clean.

```
backend/
  geometry/   # floor plan -> nav graph, routes, maze score, wall-following   (Geometry)
  agent/      # briefing agent, tools, prompts                                  (Agent and data)
  dispatch/   # audio -> transcript -> structured facts                         (Agent and data)
  data/       # CoStar / Vexcel / Matterport clients                            (Agent and data)
frontend/     # aerial map, floor plan viz, live transcript, animations         (Visuals and pitch)
fixtures/     # hero buildings, scripted calls, cached API responses
docs/         # plan, pitch outline
```

## Quick start

```bash
cp .env.example .env          # fill in keys
cd backend && python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --reload  # http://localhost:8000/health
```

## Data workflow

Setup once: unzip the CoStar hackathon kit to `costar-kit/` in the repo root (gitignored, 404 MB), then `cp .env.example .env` and fill in keys. LLM is Gemini (free key at https://aistudio.google.com/apikey).

```bash
cd backend
python -m scripts.check_access                 # CoStar kit / Matterport / Vexcel / Gemini status
python -m scripts.pick_heroes                  # rank kit buildings as hero candidates
python -m scripts.pick_heroes --check-matterport 15 --write 3   # verify scans, write top 3 to buildings.json
python -m scripts.fetch_fixtures               # cache Matterport, Vexcel and CoStar data per building
python -m scripts.process_calls                # scripted calls -> audio -> transcript -> live dispatch records
uvicorn app.main:app --reload                  # API: /buildings, /calls, /calls/{id}/replay, /fixtures/...
```

Data shapes shared between roles: [docs/CONTRACTS.md](docs/CONTRACTS.md). Sample data to build against: `fixtures/sample/`.

## Scope

Must have: 2-3 hero buildings, briefing from all three layers, dispatch call to facts, nav graph + maze score heatmap, mayday directions.
Nice to have: evacuation sim, live mic, multi-caller merge, auto indoor/aerial alignment.

See [docs/PLAN.md](docs/PLAN.md). Current progress and next steps: [docs/STATUS.md](docs/STATUS.md). Coding agents: start at [AGENTS.md](AGENTS.md).

## Ground rules

- Scripted, self-recorded calls only. No real 911 audio.
- Cache every API response into `fixtures/` so the demo works offline.
- Scanferno supports training and judgment. It does not replace on-scene verification.
