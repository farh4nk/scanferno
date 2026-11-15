"""Rerouting around fire, hose stretch, briefing sources and diffs, caller corrections."""
from fastapi.testclient import TestClient

from agent import changes
from app.main import app
from dispatch import history

client = TestClient(app)
BID = "costar-239873"
OFFICE_101, OFFICE_110, HALLWAY_A, HALLWAY_B = "r-tt6gm2", "r-tx2gws", "r-3m54yf", "r-5yms5n"


def test_route_avoids_fire_room():
    r = client.get(f"/buildings/{BID}/routes", params={"from_room": OFFICE_101, "avoid": "Hallway A"}).json()
    assert HALLWAY_A not in r["path"] and r["rerouted"] and r["through_avoided"] == []


def test_route_through_fire_when_no_other_way():
    r = client.get(f"/buildings/{BID}/routes", params={"from_room": OFFICE_110, "avoid": HALLWAY_B}).json()
    assert r["through_avoided"] == [HALLWAY_B]


def test_hose_stretch():
    h = client.get(f"/buildings/{BID}/hose", params={"to_room": "Office 110"}).json()
    assert h and h[0]["total_ft"] <= h[-1]["total_ft"] and "fits_preconnect" in h[0]


def test_briefing_claims_cite_sources():
    lines = client.get("/calls/vibe-1-clean").json()["script"]["lines"]
    d = client.post(f"/buildings/{BID}/dispatch", json={"transcript": lines, "use_llm": False}).json()
    b = client.post(f"/buildings/{BID}/briefing", json={"dispatch": d, "use_llm": False}).json()
    for key in ("entry_points", "ladder_positions", "search_plan", "exit_routes", "hose_stretch"):
        assert b[key] and all(x["sources"] for x in b[key]), key
    assert all(h["source"] for h in b["hazards"])


def test_briefing_reports_data_age():
    a = client.post(f"/buildings/{BID}/briefing", json={"dispatch": {}, "use_llm": False}).json()["data_age"]
    assert a["built"] == 1983 and a["aerial"] == "2026-01" and a["scan"] is None
    assert a["scan_floors"] == 1 and a["stories"] == 5


def test_briefing_changes():
    old = {"search_plan": [{"room_id": "a", "label": "Office A"}], "trapped": [], "hazards": []}
    new = {"search_plan": [{"room_id": "b", "label": "Office B"}], "fire_room_ids": ["b"],
           "trapped": [{"description": "coworker", "room_id": "b", "candidates": [{"label": "Office B"}]}], "hazards": []}
    kinds = [c["kind"] for c in changes.diff(old, new)]
    assert kinds == ["fire", "trapped", "search_plan"] and changes.diff(None, new) == []


def test_corrections_tracked():
    state = {}
    history.track(state, {"floor": 2, "hazards": ["gas"]}, 1.0)
    history.track(state, {"floor": 2, "hazards": ["gas", "oxygen"]}, 2.0)
    c = history.track(state, {"floor": 3, "hazards": ["oxygen"]}, 3.0)
    assert c["floor"] == [{"from": 2, "to": 3, "t": 3.0}]
    assert c["hazards"][0]["from"] == ["gas", "oxygen"] and len(c["hazards"]) == 1


def test_live_stream_carries_changes_and_corrections():
    with client.stream("GET", "/calls/vibe-2-messy/live", params={"speed": 1000, "use_llm": False}) as r:
        body = "".join(r.iter_text())
    assert '"changes"' in body and '"corrections"' in body
