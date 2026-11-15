"""Live calls happening now (see dispatch/session.py): mic or file audio through ElevenLabs STT, or
utterances recognized in the browser / typed. Every update returns the session state."""
from fastapi import APIRouter, Body, Form, HTTPException, UploadFile

from app import deps
from data import layers
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


@router.post("/sessions/{sid}/tick")
def tick(sid: str):
    """Grow heat with elapsed minutes without re-running extraction."""
    return _session(sid).tick()


@router.post("/sessions/{sid}/locations")
def locations(sid: str, payload: dict = Body(...)):
    """Apply manual fire/person room locations over the live transcript-derived record."""
    s = _session(sid)
    fire_room_id = payload.get("fire_room_id")
    people = payload.get("people", [])
    if fire_room_id is not None and not isinstance(fire_room_id, str):
        raise HTTPException(422, "fire_room_id must be a room id or null")
    if not isinstance(people, list):
        raise HTTPException(422, "people must be a list")

    rooms = {r["id"] for r in layers.floorplan(s.building_id)["rooms"]}
    if fire_room_id is not None and fire_room_id not in rooms:
        raise HTTPException(422, f"Unknown fire room {fire_room_id}")
    cleaned = []
    seen = set()
    for person in people:
        if not isinstance(person, dict):
            raise HTTPException(422, "Each person location must be an object")
        description, room_id = person.get("description"), person.get("room_id")
        manual = person.get("manual", False)
        if not isinstance(description, str) or not description.strip():
            raise HTTPException(422, "Each person needs a description")
        if not isinstance(room_id, str) or room_id not in rooms:
            raise HTTPException(422, f"Unknown person room {room_id}")
        if not isinstance(manual, bool):
            raise HTTPException(422, "manual must be a boolean")
        description = description.strip()
        key = description.casefold()
        if key in seen:
            raise HTTPException(422, f"Duplicate person location for {description}")
        seen.add(key)
        cleaned.append({"description": description, "room_id": room_id, "manual": manual})
    return s.set_locations(fire_room_id, cleaned)


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
