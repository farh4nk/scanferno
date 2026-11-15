"""Live calls happening now (see dispatch/session.py): mic or file audio through ElevenLabs STT, or
utterances recognized in the browser / typed. Every update returns the session state."""
import httpx
from fastapi import APIRouter, Body, Form, HTTPException, Response, UploadFile

from app import deps
from dispatch import elevenlabs, session

router = APIRouter(prefix="/live", tags=["live"])


def _session(sid: str) -> session.Session:
    s = session.get(sid)
    if s is None:
        raise HTTPException(404, f"No live session {sid} (sessions end when the API restarts)")
    return s


@router.get("/sessions")
def recent():
    """Calls taken since the API started (newest first), so a page reload can pick one back up."""
    out = []
    for s in sorted(session.SESSIONS.values(), key=lambda x: x.created, reverse=True):
        if not s.utterances:
            continue
        first = next((u["text"] for u in s.utterances if u["role"] == "caller"), s.utterances[0]["text"])
        out.append({"session_id": s.id, "building_id": s.building_id, "started_at": s.created, "lines": len(s.utterances),
                    "has_audio": bool(s.audio), "preview": first[:90]})
    return out[:10]


@router.get("/sessions/{sid}/audio")
def recording(sid: str):
    """The mic recording of this call, as it was uploaded."""
    s = _session(sid)
    if not s.audio:
        raise HTTPException(404, "This call has no recording")
    data, name = s.audio
    ext = name.rsplit(".", 1)[-1].lower() if "." in name else "webm"
    kind = {"webm": "audio/webm", "ogg": "audio/ogg", "m4a": "audio/mp4", "mp4": "audio/mp4", "wav": "audio/wav", "mp3": "audio/mpeg"}.get(ext, "application/octet-stream")
    return Response(data, media_type=kind)


@router.post("/sessions")
def create(building_id: str = Body(..., embed=True), use_llm: bool | None = Body(None, embed=True)):
    deps.building(building_id)
    return session.create(building_id, use_llm).state()


@router.get("/sessions/{sid}")
def state(sid: str):
    return _session(sid).state()


@router.post("/sessions/{sid}/audio")
async def audio(sid: str, file: UploadFile, first_role: str = Form("dispatcher")):
    """The whole recording so far (or an uploaded call). Re-transcribed each time; diarized speakers become
    roles in order of first appearance, starting with `first_role`."""
    s = _session(sid)
    data = await file.read()
    if not data:
        raise HTTPException(400, "Empty audio")
    try:
        return s.transcribe(data, file.filename or "call.webm", first_role)
    except elevenlabs.NotConfigured as e:
        raise HTTPException(503, str(e))
    except httpx.HTTPStatusError as e:
        raise HTTPException(*_stt_error(e))
    except Exception as e:
        raise HTTPException(502, f"Transcription failed: {type(e).__name__}: {e}")


def _stt_error(e: httpx.HTTPStatusError) -> tuple[int, str]:
    """ElevenLabs answers an empty quota with a 401; say what actually happened (402 = out of credits)."""
    try:
        code = e.response.json()["detail"]["code"]
    except Exception:
        code = ""
    if code == "quota_exceeded":
        return 402, "ElevenLabs is out of credits, so it can't transcribe. Top up the account, or use browser speech."
    if e.response.status_code in (401, 403):
        return 503, "ElevenLabs rejected the API key (it may lack the speech-to-text permission)."
    return 502, f"Transcription failed: ElevenLabs returned {e.response.status_code}"


@router.post("/sessions/{sid}/utterances")
def utterances(sid: str, utterances: list[dict] = Body(..., embed=True)):
    """The full transcript so far as [{role, text, start?, end?}] (browser speech recognition or typed)."""
    return _session(sid).update(utterances)


@router.post("/sessions/{sid}/tick")
def tick(sid: str):
    """Grow heat with elapsed minutes without re-running extraction."""
    return _session(sid).tick()


@router.post("/sessions/{sid}/building")
def set_building(sid: str, building_id: str = Body(..., embed=True)):
    """Keep the transcript; rebind to another building and rebuild locate + briefing + rescue."""
    deps.building(building_id)
    return _session(sid).set_building(building_id)


@router.post("/sessions/{sid}/save")
def save(sid: str, title: str | None = Body(None, embed=True)):
    s = _session(sid)
    if not s.utterances:
        raise HTTPException(400, "Nothing to save yet")
    return {"call_id": s.save(title)}


@router.delete("/sessions/{sid}")
def end(sid: str):
    return {"ended": session.end(sid)}
