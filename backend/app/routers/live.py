"""Live calls happening now (see dispatch/session.py): mic or file audio through ElevenLabs STT, or
utterances recognized in the browser / typed. Every update returns the session state."""
from fastapi import APIRouter, Body, Form, HTTPException, UploadFile

from app import deps
from dispatch import elevenlabs, session

router = APIRouter(prefix="/live", tags=["live"])


def _session(sid: str) -> session.Session:
    s = session.get(sid)
    if s is None:
        raise HTTPException(404, f"No live session {sid} (sessions end when the API restarts)")
    return s


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
    except Exception as e:
        raise HTTPException(502, f"Transcription failed: {type(e).__name__}: {e}")


@router.post("/sessions/{sid}/utterances")
def utterances(sid: str, utterances: list[dict] = Body(..., embed=True)):
    """The full transcript so far as [{role, text, start?, end?}] (browser speech recognition or typed)."""
    return _session(sid).update(utterances)


@router.post("/sessions/{sid}/save")
def save(sid: str, title: str | None = Body(None, embed=True)):
    s = _session(sid)
    if not s.utterances:
        raise HTTPException(400, "Nothing to save yet")
    return {"call_id": s.save(title)}


@router.delete("/sessions/{sid}")
def end(sid: str):
    return {"ended": session.end(sid)}
