import asyncio
import json
from pathlib import Path

from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

load_dotenv(Path(__file__).resolve().parents[2] / ".env")

from data import cache  # noqa: E402
from dispatch import elevenlabs, extract, pipeline  # noqa: E402

app = FastAPI(title="Scanferno")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])
# Everything cached (images, audio, JSON) is served as-is: /fixtures/costar-239873/vexcel/nadir.jpg
app.mount("/fixtures", StaticFiles(directory=cache.FIXTURES), name="fixtures")


@app.get("/health")
def health():
    return {"ok": True}


@app.get("/buildings")
def buildings():
    return cache.buildings()


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
