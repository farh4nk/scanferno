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
    lines = client.get("/calls/vibe-1-clean").json()["script"]["lines"]
    d = client.post(f"/buildings/{BID}/dispatch", json={"transcript": lines, "use_llm": False}).json()
    b = client.post(f"/buildings/{BID}/briefing", json={"dispatch": d, "use_llm": False}).json()
    assert b["trapped"] and b["search_plan"]


def test_briefing_accepts_raw_gemini_record():
    rec = client.get("/calls/vibe-1-clean").json()["timeline"][-1]["record"]
    b = client.post(f"/buildings/{BID}/briefing", json={"dispatch": rec, "use_llm": False}).json()
    assert b["search_plan"]


def test_live_stream():
    with client.stream("GET", "/calls/vibe-1-clean/live", params={"speed": 1000, "use_llm": False}) as r:
        body = "".join(r.iter_text())
    assert "event: utterance" in body and "event: record" in body and "event: briefing" in body and "event: done" in body
    with client.stream("GET", "/calls/vibe-mayday/live", params={"speed": 1000, "use_llm": False}) as r:
        assert "event: mayday" in "".join(r.iter_text())


def test_unknown_building():
    assert client.get("/buildings/nope/floorplan").status_code == 404


def test_tour_clips_in_and_out():
    t = client.get(f"/buildings/{BID}/tour", params={"to_room": "Office 110"}).json()
    assert t["room_id"] == "r-tx2gws" and t["entries"]
    start = t["in"]["polyline"][0]
    assert abs(start[0] - t["entry"]["position"][0]) < 0.02 and abs(start[1] - t["entry"]["position"][1]) < 0.02
    assert t["in"]["rooms"][-1] == t["room_id"]
    assert t["out"]["polyline"][0] != t["out"]["polyline"][-1] and t["out"]["rooms"][0] == t["room_id"]
    for leg in (t["in"], t["out"]):
        s = [x["at_m"] for x in leg["steps"]]
        assert s == sorted(s) and s[0] == 0 and abs(s[-1] - leg["distance_m"]) < 0.2
    # a chosen entry door is honored for the way in, and the way out can be routed around a room
    other = t["entries"][-1]["door_id"]
    t2 = client.get(f"/buildings/{BID}/tour", params={"to_room": "Office 110", "entry": other, "avoid": "Hallway B"}).json()
    assert t2["entry"]["door_id"] == other and t2["in"]["door_id"] == other
    assert client.get(f"/buildings/{BID}/tour", params={"to_room": "zzz nowhere"}).status_code == 404


def test_simulation_goes_inside_every_room_in_order_then_out():
    from shapely.geometry import LineString, Point, Polygon

    fp = client.get(f"/buildings/{BID}/floorplan").json()
    by_id = {r["id"]: r for r in fp["rooms"]}
    rooms = [r["id"] for r in fp["rooms"] if r["type"] != "void"][:5]
    s = client.get(f"/buildings/{BID}/simulation", params={"rooms": ",".join(rooms)}).json()
    assert s["rooms"] == rooms and [x["order"] for x in s["stops"]] == [1, 2, 3, 4, 5]
    kinds = [leg["kind"] for leg in s["legs"]]
    assert kinds == ["in"] + ["search"] * 4 + ["out"]  # nothing extra is walked inside a room
    at = [x["at_m"] for x in s["stops"]]
    assert at == sorted(at) and 0 < at[0] and at[-1] < s["total_m"]
    assert abs(s["in_m"] + s["search_m"] + s["out_m"] - s["total_m"]) < 0.5
    assert s["clip"]["polyline"] == s["polyline"] and s["clip"]["steps"][0]["at_m"] == 0
    # each leg ends inside its room, well clear of the walls, and the run passes through that point
    segs = s["clip"]["segments"]
    assert [x["kind"] for x in segs] == kinds
    assert [x["room_id"] for x in segs[:-1]] == rooms and segs[-1]["room_id"] is None
    line = LineString(s["polyline"])
    for st in s["stops"]:
        r = by_id[st["room_id"]]
        poly = Polygon(r["polygon"], r.get("holes") or [])
        p = Point(st["xy"])
        assert poly.contains(p) and poly.boundary.distance(p) >= 0.3, r["label"]
        assert line.distance(p) < 0.05, r["label"]
    assert client.get(f"/buildings/{BID}/simulation", params={"rooms": "zzz nowhere"}).status_code == 404
