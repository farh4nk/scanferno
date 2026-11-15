"""Live transcription sessions: typed / browser utterances, server STT (stubbed with a cached transcript), save."""
import shutil

from fastapi.testclient import TestClient

from app.main import app
from data import cache
from dispatch import elevenlabs, pipeline

client = TestClient(app)
BID = "costar-239873"


def _new() -> str:
    return client.post("/live/sessions", json={"building_id": BID, "use_llm": False}).json()["session_id"]


def test_typed_utterances_build_record_and_briefing():
    sid = _new()
    lines = client.get("/calls/vibe-1-clean").json()["script"]["lines"]
    r = client.post(f"/live/sessions/{sid}/utterances", json={"utterances": lines}).json()
    assert r["extracted"] and r["record"]["trapped"] and r["briefing"]["search_plan"]
    again = client.post(f"/live/sessions/{sid}/utterances", json={"utterances": lines}).json()
    assert not again["extracted"] and again["updates"] == 1


def test_manual_room_locations_override_transcription_until_cleared():
    sid = _new()
    fp = client.get(f"/buildings/{BID}/floorplan").json()
    rooms = fp["rooms"]
    transcript = [{"role": "caller", "text": "My coworker is trapped in the kitchen. The fire is in the office."}]
    initial = client.post(f"/live/sessions/{sid}/utterances", json={"utterances": transcript}).json()
    auto_person_room = initial["record"]["trapped"][0]["room_id"]
    auto_fire_room = initial["record"]["fire_room_ids"][0]
    manual_person_room = next(r["id"] for r in rooms if r["id"] != auto_person_room)
    manual_fire_room = next(r["id"] for r in rooms if r["id"] not in (auto_person_room, auto_fire_room))
    added_person_room = next(r["id"] for r in rooms if r["id"] not in (auto_person_room, auto_fire_room, manual_fire_room))

    updated = client.post(f"/live/sessions/{sid}/locations", json={
        "fire_room_id": manual_fire_room,
        "people": [
            {"description": "coworker", "room_id": manual_person_room},
            {"description": "caller", "room_id": added_person_room, "manual": True},
        ],
    })
    assert updated.status_code == 200
    state = updated.json()
    assert state["record"]["fire_room_ids"] == [manual_fire_room]
    assert state["record"]["trapped"][0]["room_id"] == manual_person_room
    assert state["record"]["trapped"][0]["location_source"] == "manual"
    assert state["briefing"]["trapped"][0]["location_source"] == "manual"
    assert any(p["description"] == "caller" and p["manual"] for p in state["record"]["trapped"])

    transcript.append({"role": "caller", "text": "A patient is trapped in the kitchen."})
    later = client.post(f"/live/sessions/{sid}/utterances", json={"utterances": transcript}).json()
    assert later["extracted"]
    assert later["record"]["fire_room_ids"] == [manual_fire_room]
    coworker = next(p for p in later["record"]["trapped"] if p["description"] == "coworker")
    assert coworker["room_id"] == manual_person_room and coworker["location_source"] == "manual"
    assert any(p["description"] == "caller" and p["room_id"] == added_person_room for p in later["record"]["trapped"])
    new_person = next(p for p in later["record"]["trapped"] if p["description"] == "patient")
    assert new_person["room_id"] and new_person["location_source"] == "transcription"
    assert any(p["room_id"] == new_person["room_id"] for p in later["briefing"]["rescue"]["people"])
    assert any(c["kind"] == "trapped" and c["room_id"] == new_person["room_id"] for c in later["briefing"]["changes"])
    assert len(later["record"]["trapped"]) > 1

    cleared = client.post(f"/live/sessions/{sid}/locations", json={"fire_room_id": None, "people": []}).json()
    assert cleared["record"]["fire_location_source"] == "transcription"
    restored = next(p for p in cleared["record"]["trapped"] if p["description"] == "coworker")
    assert restored["room_id"] == auto_person_room and restored["location_source"] == "transcription"
    assert not any(p["description"] == "caller" for p in cleared["record"]["trapped"])


def test_manual_locations_reject_unknown_rooms():
    sid = _new()
    response = client.post(f"/live/sessions/{sid}/locations", json={"fire_room_id": "not-a-room", "people": []})
    assert response.status_code == 422


def test_transcript_movement_and_fire_spread_refresh_rescue_plan():
    sid = _new()
    rooms = {r["label"]: r["id"] for r in client.get(f"/buildings/{BID}/floorplan").json()["rooms"]}
    lines = [{"role": "caller", "text": "My coworker is trapped in Office 101. Fire is in Kitchen 106."}]
    initial = client.post(f"/live/sessions/{sid}/utterances", json={"utterances": lines}).json()
    original = next(p for p in initial["briefing"]["rescue"]["people"] if p["description"] == "coworker")
    fire_kitchen = rooms["Kitchen 106"]

    lines.append({"role": "caller", "text": "My coworker moved from Office 101 to Office 110, and the fire has spread to Office 104."})
    lines.append({"role": "caller", "text": "My coworker is now by the door."})
    updated = client.post(f"/live/sessions/{sid}/utterances", json={"utterances": lines}).json()
    coworker = next(p for p in updated["briefing"]["rescue"]["people"] if p["description"] == "coworker")
    moved_room = rooms["Office 110"]
    fire_office = rooms["Office 104"]

    assert updated["record"]["fire_room_ids"] == [fire_kitchen, fire_office]
    assert updated["briefing"]["heat"]["fire_room_ids"] == [fire_kitchen, fire_office]
    assert coworker["room_id"] == moved_room and coworker["id"] == original["id"]
    assert coworker["position"] != original["position"]
    assert updated["record"]["trapped"][0]["near"] == "by the door"
    assert "trapped" in updated["record"]["changed"]
    assert coworker["recommended_route"]["entry"]["polyline"]
    assert coworker["recommended_route"]["extraction"]["polyline"]
    assert {c["kind"] for c in updated["briefing"]["changes"]} >= {"fire_spread", "person_moved"}


def test_audio_uses_stt_and_diarized_roles(monkeypatch):
    cached = cache.load_json("calls", "vibe-1-clean", "transcript.json")
    monkeypatch.setattr(elevenlabs, "stt", lambda audio, name: cached)
    sid = _new()
    r = client.post(f"/live/sessions/{sid}/audio", files={"file": ("call.webm", b"fake-audio", "audio/webm")}).json()
    assert r["utterances"][0]["role"] == "dispatcher" and r["record"]["trapped"]
    flipped = pipeline.utterances(cached, first_role="caller")
    assert flipped[0]["role"] == "caller"


def test_audio_without_key_is_503(monkeypatch):
    monkeypatch.delenv("ELEVENLABS_API_KEY", raising=False)
    sid = _new()
    r = client.post(f"/live/sessions/{sid}/audio", files={"file": ("call.webm", b"x", "audio/webm")})
    assert r.status_code == 503 and "ELEVENLABS_API_KEY" in r.json()["detail"]
    assert client.get("/health").json()["stt"] is False


def test_mayday_line_gives_directions():
    sid = _new()
    r = client.post(f"/live/sessions/{sid}/utterances", json={"utterances": [
        {"role": "caller", "text": "Mayday mayday mayday, Engine 23, we're lost in Office 110"}]}).json()
    assert r["mayday"]["from_room_id"] == "r-tx2gws" and r["mayday"]["directions"]


def test_save_makes_a_replayable_call(monkeypatch):
    cached = cache.load_json("calls", "vibe-1-clean", "transcript.json")
    monkeypatch.setattr(elevenlabs, "stt", lambda audio, name: cached)
    sid = _new()
    client.post(f"/live/sessions/{sid}/audio", files={"file": ("call.webm", b"fake-audio", "audio/webm")})
    call_id = client.post(f"/live/sessions/{sid}/save", json={"title": "test call"}).json()["call_id"]
    try:
        listed = next(c for c in client.get("/calls").json() if c["call_id"] == call_id)
        assert listed["has_audio"] and listed["audio_url"].endswith("audio.webm") and listed["kind"] == "live"
        with client.stream("GET", f"/calls/{call_id}/live", params={"speed": 1000, "use_llm": False}) as r:
            body = "".join(r.iter_text())
        assert "event: record" in body and "event: briefing" in body
    finally:
        shutil.rmtree(pipeline.call_dir(call_id), ignore_errors=True)


def test_unknown_session_and_building():
    assert client.get("/live/sessions/nope").status_code == 404
    assert client.post("/live/sessions", json={"building_id": "nope"}).status_code == 404


def test_call_frames_are_seekable():
    from fastapi.testclient import TestClient
    from app.main import app
    r = TestClient(app).get("/calls/vibe-1-clean/frames").json()
    assert r["utterances"] and r["frames"] and r["duration"] > 0
    ts = [f["t"] for f in r["frames"]]
    assert ts == sorted(ts)
    last = r["frames"][-1]["briefing"]
    assert last["trapped"] and last["fire_room_ids"]
    assert any(c["kind"] == "trapped" for f in r["frames"] for c in f["briefing"]["changes"])


def test_mayday_call_frames_carry_directions():
    from fastapi.testclient import TestClient
    from app.main import app
    r = TestClient(app).get("/calls/vibe-mayday/frames").json()
    assert any(f.get("mayday", {}).get("directions") for f in r["frames"])


def test_speech_validates_input_and_serves_cache():
    from fastapi.testclient import TestClient
    from app.main import app
    from data import cache
    c = TestClient(app)
    assert c.post("/speech", json={"text": "  ", "voice": "narrator"}).status_code == 400
    assert c.post("/speech", json={"text": "hi", "voice": "robot"}).status_code == 400
    from app.routers.speech import cache_key
    meta = {"text": "cached line", "voice": "narrator", "audio_url": "/fixtures/tts/x.mp3", "words": []}
    key = cache_key("cached line", "narrator")
    p = cache.save_json(meta, "tts", f"{key}.json")
    try:
        r = c.post("/speech", json={"text": "cached   line", "voice": "narrator"}).json()
        assert r["cached"] and r["audio_url"] == meta["audio_url"]
    finally:
        p.unlink()


def test_stutter_detector_flags_stretched_words_only():
    from dispatch.elevenlabs import _glitchy
    assert _glitchy([{"word": "follow", "start": 6.2, "end": 7.73}])          # the real stutter we heard
    assert not _glitchy([{"word": "follow", "start": 6.38, "end": 6.63}, {"word": "8866", "start": 0.8, "end": 1.98}])
