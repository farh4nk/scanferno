import asyncio
import json
import time
from pathlib import Path

from dotenv import load_dotenv
from fastapi import Body, FastAPI, HTTPException, Query, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

load_dotenv(Path(__file__).resolve().parents[2] / ".env")

from agent import ask as ask_agent  # noqa: E402
from agent import briefing as briefing_agent  # noqa: E402
from data import cache, layers  # noqa: E402
from dispatch import elevenlabs, extract, facts, pipeline  # noqa: E402
from dispatch.locate import locate  # noqa: E402
from geometry import evac, wallfollow  # noqa: E402

app = FastAPI(title="Scanferno")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])
# Everything cached (images, audio, JSON) is served as-is: /fixtures/costar-239873/vexcel/nadir.jpg
app.mount("/fixtures", StaticFiles(directory=cache.FIXTURES), name="fixtures")


@app.get("/health")
def health():
    return {"ok": True, "llm": facts.llm_available()}


@app.get("/buildings")
def buildings():
    out = []
    for b in cache.buildings():
        c = layers.costar(b["id"])
        out.append({**b, "stories": c.get("stories"), "year_built": c.get("year_built"), "tenants": c.get("current_tenant_count")})
    return out


@app.get("/calls")
def calls():
    return pipeline.list_calls()


@app.get("/calls/{call_id}")
def call(call_id: str):
    script = cache.load_json("calls", call_id, "script.json")
    if not script:
        raise HTTPException(404, f"no call {call_id}")
    return {
        "call_id": call_id,
        "script": script,
        "audio_url": f"/fixtures/calls/{call_id}/audio.wav",
        **(cache.load_json("calls", call_id, "timeline.json") or {"utterances": [], "timeline": []}),
    }


@app.get("/calls/{call_id}/replay")
async def replay(call_id: str, speed: float = 1.0):
    """Server-sent events in call time: `utterance` when someone speaks, `record` when facts update.
    Start the audio at the same moment as the stream for a synced demo."""
    data = cache.load_json("calls", call_id, "timeline.json")
    if not data:
        raise HTTPException(404, f"no timeline for {call_id}; run scripts.process_calls")
    events = [(u["start"], "utterance", {"index": i, **u}) for i, u in enumerate(data["utterances"])]
    events += [(s["t"], "record", s) for s in data["timeline"]]
    events.sort(key=lambda e: e[0])

    async def stream():
        clock = 0.0
        for t, kind, payload in events:
            await asyncio.sleep(max(0.0, (t - clock) / speed))
            clock = t
            yield f"event: {kind}\ndata: {json.dumps(payload)}\n\n"
        yield "event: done\ndata: {}\n\n"

    return StreamingResponse(stream(), media_type="text/event-stream")


def _sse(event: str, data) -> str:
    return f"event: {event}\ndata: {json.dumps(data, default=str)}\n\n"


def _script_utterances(script: dict) -> list[dict]:
    """Timing for calls that have no audio yet: ~2.6 words/s plus the script's pauses."""
    t, out = 0.0, []
    for line in script["lines"]:
        dur = max(1.0, len(line["text"].split()) / 2.6)
        out.append({"role": line["role"], "start": round(t, 2), "end": round(t + dur, 2), "text": line["text"]})
        t += dur + line.get("pause", 0.7)
    return out


@app.get("/calls/{call_id}/live")
def live(call_id: str, speed: float = 1.0, use_llm: bool | None = None):
    """The full demo stream for any call. Same `utterance` / `record` events as /replay, plus `briefing`
    (rebuilt after every record) and `mayday` (wall-following directions, for mayday calls), then `done`.
    Calls with a cached timeline replay its records; others are extracted as they go."""
    script = cache.load_json("calls", call_id, "script.json")
    if not script:
        raise HTTPException(404, f"no call {call_id}")
    bid = script["building_id"]
    data = cache.load_json("calls", call_id, "timeline.json")
    utts = data["utterances"] if data else _script_utterances(script)
    cached = {s["utterance_index"]: s["record"] for s in data["timeline"]} if data else {}

    def events():
        start = time.monotonic()
        record = None
        for i, u in enumerate(utts):
            wait = u["start"] / max(speed, 0.01) - (time.monotonic() - start)
            if wait > 0:
                time.sleep(wait)
            yield _sse("utterance", {"index": i, **u})
            if u["role"] == "dispatcher":
                continue
            if script.get("kind") == "mayday":
                c = locate(u["text"], layers.floorplan(bid), layers.nav(bid), top=1)
                if c:
                    yield _sse("mayday", wallfollow.mayday(layers.floorplan(bid), c[0]["room_id"], layers.nav(bid), layers.sides(bid).of_local))
                continue
            if i in cached:
                record = facts.resolve_rooms(facts.normalize(cached[i], bid), bid)
                record["extractor"] = "cached timeline"
            else:
                record = facts.extract(utts[: i + 1], bid, use_llm, previous=record)
            yield _sse("record", {"t": u["end"], "utterance_index": i, "record": record})
            yield _sse("briefing", briefing_agent.build(bid, record, use_llm=False))
        if record is not None and (use_llm if use_llm is not None else facts.llm_available()):
            yield _sse("briefing", briefing_agent.build(bid, record, use_llm=True))
        yield _sse("done", {"elapsed_s": round(time.monotonic() - start, 1)})

    return StreamingResponse(events(), media_type="text/event-stream", headers={"Cache-Control": "no-cache"})


class ExtractRequest(BaseModel):
    building_id: str | None = None
    transcript: list[dict]  # [{role, text}]
    previous: dict | None = None


@app.post("/dispatch/extract")
def dispatch_extract(req: ExtractRequest):
    """Typed fallback and live mode: send the transcript so far, get the updated record."""
    return extract.extract(req.transcript, req.building_id, req.previous)


@app.post("/dispatch/transcribe")
async def dispatch_transcribe(file: UploadFile):
    """Upload a recording, get speaker-separated utterances."""
    result = elevenlabs.stt(await file.read(), file.filename or "call.wav")
    return {"text": result.get("text"), "utterances": pipeline.utterances(result)}


# ---- briefing, geometry, Q&A (per building) ----

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
    r = layers.nav(bid).to_exit(_room_id(bid, from_room))
    if r is None:
        raise HTTPException(404, "No route to an exit")
    r.pop("nodes", None)
    return r


@app.get("/buildings/{bid}/mayday")
def mayday(bid: str, room: str = Query(..., description="room id, label, or the mayday call text")):
    _building(bid)
    return wallfollow.mayday(layers.floorplan(bid), _room_id(bid, room), layers.nav(bid), layers.sides(bid).of_local)


@app.get("/buildings/{bid}/evac")
def evacuation(bid: str, occupants: int | None = None):
    _building(bid)
    if occupants is None:
        occupants = briefing_agent.costar_hazards(layers.costar(bid), 1)[1]["employees_estimate"] or 30
    return evac.simulate(layers.floorplan(bid), occupants, layers.nav(bid))


@app.post("/buildings/{bid}/dispatch")
def dispatch(bid: str, transcript: list[dict] = Body(..., embed=True), use_llm: bool | None = Body(None, embed=True)):
    """Dispatch record ready for the briefing: Gemini or offline rules, plus room candidates."""
    _building(bid)
    return facts.extract(transcript, bid, use_llm)


@app.post("/buildings/{bid}/briefing")
def briefing(bid: str, dispatch: dict | None = Body(None, embed=True), use_llm: bool | None = Body(None, embed=True)):
    _building(bid)
    if dispatch and not dispatch.get("fire_candidates"):
        dispatch = facts.resolve_rooms(facts.normalize(dispatch, bid), bid)
    return briefing_agent.build(bid, dispatch, use_llm)


@app.post("/buildings/{bid}/ask")
def ask(bid: str, question: str = Body(..., embed=True), dispatch: dict | None = Body(None, embed=True),
        use_llm: bool | None = Body(None, embed=True)):
    _building(bid)
    return ask_agent.ask(bid, question, dispatch, use_llm)
