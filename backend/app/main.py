import json
import time
from pathlib import Path

from dotenv import load_dotenv

load_dotenv(Path(__file__).resolve().parents[2] / ".env")

from fastapi import Body, FastAPI, File, HTTPException, Query, UploadFile  # noqa: E402
from fastapi.middleware.cors import CORSMiddleware  # noqa: E402
from fastapi.responses import StreamingResponse  # noqa: E402
from fastapi.staticfiles import StaticFiles  # noqa: E402

from agent import ask as ask_agent  # noqa: E402
from agent import briefing as briefing_agent  # noqa: E402
from data import cache, layers  # noqa: E402
from dispatch import extract as dispatch_extract  # noqa: E402
from dispatch import stt  # noqa: E402
from dispatch.locate import locate  # noqa: E402
from geometry import evac, wallfollow  # noqa: E402

app = FastAPI(title="Scanferno")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])
app.mount("/fixtures", StaticFiles(directory=cache.FIXTURES), name="fixtures")


def _building(bid: str) -> dict:
    try:
        return layers.building(bid)
    except KeyError:
        raise HTTPException(404, f"Unknown building {bid}")


def _room_id(bid: str, text: str) -> str:
    fp = layers.floorplan(bid)
    if any(r["id"] == text for r in fp["rooms"]):
        return text
    c = locate(text, fp, layers.nav(bid), _building(bid).get("front", "S"), top=1)
    if not c:
        raise HTTPException(404, f"No room matches '{text}'")
    return c[0]["room_id"]


def _calls(bid: str) -> list[dict]:
    d = cache.FIXTURES / bid / "calls"
    return [json.loads(p.read_text()) for p in sorted(d.glob("*.json"))] if d.exists() else []


@app.get("/health")
def health():
    return {"ok": True, "llm": dispatch_extract.llm_available(), "stt": stt.available()}


@app.get("/buildings")
def buildings():
    out = []
    for b in cache.buildings():
        c = layers.costar(b["id"])
        out.append({**{k: b.get(k) for k in ("id", "name", "address", "lat", "lon")},
                    "stories": c.get("stories"), "year_built": c.get("year_built"),
                    "tenants": c.get("current_tenant_count"), "calls": [x["id"] for x in _calls(b["id"])]})
    return out


@app.get("/buildings/{bid}")
def building(bid: str):
    b = _building(bid)
    return {"building": b, "costar": layers.costar(bid), "outside": layers.outside(bid)}


@app.get("/buildings/{bid}/floorplan")
def floorplan(bid: str):
    _building(bid)
    return layers.floorplan(bid)


@app.get("/buildings/{bid}/routes")
def routes(bid: str, from_room: str = Query(..., description="room id, label or description")):
    _building(bid)
    rid = _room_id(bid, from_room)
    r = layers.nav(bid).to_exit(rid)
    if r is None:
        raise HTTPException(404, "No route to an exit")
    r.pop("nodes", None)
    return r


@app.get("/buildings/{bid}/mayday")
def mayday(bid: str, room: str = Query(..., description="room id, label, or the mayday call text")):
    _building(bid)
    rid = _room_id(bid, room)
    return wallfollow.mayday(layers.floorplan(bid), rid, layers.nav(bid), layers.sides(bid).of_local)


@app.get("/buildings/{bid}/evac")
def evacuation(bid: str, occupants: int | None = None):
    _building(bid)
    if occupants is None:
        occupants = briefing_agent.costar_hazards(layers.costar(bid), 1)[1]["employees_estimate"] or 30
    return evac.simulate(layers.floorplan(bid), occupants, layers.nav(bid))


@app.get("/buildings/{bid}/calls")
def calls(bid: str):
    _building(bid)
    return _calls(bid)


@app.post("/buildings/{bid}/dispatch")
def dispatch(bid: str, transcript: list[dict] = Body(..., embed=True), use_llm: bool | None = Body(None, embed=True)):
    _building(bid)
    return dispatch_extract.extract(transcript, bid, use_llm)


@app.post("/buildings/{bid}/briefing")
def briefing(bid: str, dispatch: dict | None = Body(None, embed=True), use_llm: bool | None = Body(None, embed=True)):
    _building(bid)
    return briefing_agent.build(bid, dispatch, use_llm)


@app.post("/buildings/{bid}/ask")
def ask(bid: str, question: str = Body(..., embed=True), dispatch: dict | None = Body(None, embed=True),
        use_llm: bool | None = Body(None, embed=True)):
    _building(bid)
    return ask_agent.ask(bid, question, dispatch, use_llm)


@app.post("/transcribe")
async def transcribe(file: UploadFile = File(...)):
    audio = await file.read()
    try:
        return {"transcript": stt.transcribe(audio, file.content_type or "audio/wav"), "provider": stt.available()}
    except RuntimeError as e:
        raise HTTPException(501, str(e))


def _sse(event: str, data) -> str:
    return f"event: {event}\ndata: {json.dumps(data, default=str)}\n\n"


@app.get("/buildings/{bid}/calls/{call_id}/stream")
def stream_call(bid: str, call_id: str, speed: float = 1.0, use_llm: bool | None = None):
    """Replay a scripted call in real time. Events: transcript (one line), dispatch (facts so far),
    briefing (rebuilt after each caller line), mayday (for mayday calls), done."""
    _building(bid)
    call = next((c for c in _calls(bid) if c["id"] == call_id), None)
    if call is None:
        raise HTTPException(404, f"Unknown call {call_id}")

    def events():
        start = time.monotonic()
        lines = []
        for line in call["transcript"]:
            wait = line.get("t", 0) / max(speed, 0.01) - (time.monotonic() - start)
            if wait > 0:
                time.sleep(wait)
            lines.append(line)
            yield _sse("transcript", line)
            if line.get("speaker") == "dispatcher":
                continue
            if call.get("kind") == "mayday":
                rid = _room_id(bid, line["text"])
                yield _sse("mayday", wallfollow.mayday(layers.floorplan(bid), rid, layers.nav(bid), layers.sides(bid).of_local))
                continue
            d = dispatch_extract.extract(lines, bid, use_llm)
            yield _sse("dispatch", d)
            yield _sse("briefing", briefing_agent.build(bid, d, use_llm=False))
        if call.get("kind") != "mayday":
            final = dispatch_extract.extract(lines, bid, use_llm)
            yield _sse("briefing", briefing_agent.build(bid, final, use_llm))
        yield _sse("done", {"elapsed_s": round(time.monotonic() - start, 1)})

    return StreamingResponse(events(), media_type="text/event-stream", headers={"Cache-Control": "no-cache"})
