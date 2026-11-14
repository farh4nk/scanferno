"""Scanferno API. Endpoints live in app/routers/, one file per area:

    buildings.py   /buildings, /buildings/{id}/... (layers, routes, mayday, evac, hose, dispatch, briefing, ask)
    calls.py       /calls, /calls/{id}, /calls/{id}/replay, /calls/{id}/live (SSE)
    dispatch.py    /dispatch/extract, /dispatch/transcribe
    live.py        /live/sessions/... (calls happening now: mic, uploaded audio, browser speech, typed)
    search.py      /search, /properties/{id}

Paths are the contract with frontend/src/api/ and viewer3d; keep them stable.
"""
from pathlib import Path

from dotenv import load_dotenv
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

load_dotenv(Path(__file__).resolve().parents[2] / ".env")

from app.routers import buildings, calls, dispatch, live, search, speech  # noqa: E402
from data import cache  # noqa: E402
from dispatch import elevenlabs, facts  # noqa: E402

app = FastAPI(title="Scanferno")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])
# Everything cached (images, audio, JSON) is served as-is: /fixtures/costar-239873/vexcel/nadir.jpg
app.mount("/fixtures", StaticFiles(directory=cache.FIXTURES), name="fixtures")

for r in (buildings, calls, dispatch, live, search, speech):
    app.include_router(r.router)


@app.get("/health", tags=["meta"])
def health():
    return {"ok": True, "llm": facts.llm_available(), "stt": elevenlabs.available(), "buildings": len(cache.buildings())}
