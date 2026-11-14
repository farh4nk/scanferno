from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)
BID = "costar-239873"


def test_buildings_and_floorplan():
    assert client.get("/health").json()["ok"]
    ids = [b["id"] for b in client.get("/buildings").json()]
    assert BID in ids
    fp = client.get(f"/buildings/{BID}/floorplan").json()
    assert fp["rooms"] and fp["maze_score"]


def test_mayday_from_text():
    r = client.get(f"/buildings/{BID}/mayday", params={"room": "Mayday, crew lost in Office 110"}).json()
    assert r["from_room_id"] == "r-tx2gws" and r["directions"]


def test_dispatch_then_briefing():
    calls = client.get(f"/buildings/{BID}/calls").json()
    call = next(c for c in calls if c["id"] == "call-1")
    d = client.post(f"/buildings/{BID}/dispatch", json={"transcript": call["transcript"], "use_llm": False}).json()
    b = client.post(f"/buildings/{BID}/briefing", json={"dispatch": d, "use_llm": False}).json()
    assert b["trapped"] and b["search_plan"]


def test_stream_replay():
    with client.stream("GET", f"/buildings/{BID}/calls/call-1/stream", params={"speed": 1000, "use_llm": False}) as r:
        body = "".join(r.iter_text())
    assert "event: transcript" in body and "event: briefing" in body and "event: done" in body


def test_unknown_building():
    assert client.get("/buildings/nope/floorplan").status_code == 404
