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
