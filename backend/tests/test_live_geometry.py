"""Heat + rescue nested on live briefing; address resolve; session rebind."""
from fastapi.testclient import TestClient

from agent import live_geometry, rescue
from app.main import app
from data import directory

client = TestClient(app)
BID = "costar-239873"


def test_attach_heat_and_rescue_polylines():
    d = {
        "floor": 1,
        "conditions": ["smoke"],
        "fire_room_ids": ["r-2qdmc5"],
        "fire_candidates": [{"room_id": "r-2qdmc5", "confidence": 0.8}],
        "trapped": [{"description": "coworker", "near": "kitchen", "room_id": "r-2qdmc5",
                     "confidence": 0.8, "room_candidates": [{"room_id": "r-2qdmc5", "label": "Kitchen 106",
                                                             "confidence": 0.8, "why": "is kitchen"}]}],
    }
    brief = {"building_id": BID}
    live_geometry.attach(BID, d, brief, minutes=0.0)
    assert brief["heat"]["rooms"]
    assert "cells" not in brief["heat"]
    people = brief["rescue"]["people"]
    assert people and people[0]["entry"]["polyline"] and people[0]["extraction"]["polyline"]
    recommended = people[0]["recommended_route"]
    assert recommended["entry"] == people[0]["entry"]
    assert recommended["extraction"] == people[0]["extraction"]
    assert recommended["time_s"] == people[0]["total_time_s"]
    assert recommended["distance_m"] == round(people[0]["entry"]["distance_m"] + people[0]["extraction"]["distance_m"], 1)
    assert brief["rescue"]["route_objective"] == "minimum modeled response time with fire-exposure penalties"
    hotter = {"building_id": BID}
    live_geometry.attach(BID, d, hotter, minutes=5.0)
    cold = next(iter(brief["heat"]["rooms"].values()))["danger"]
    warm = next(iter(hotter["heat"]["rooms"].values()))["danger"]
    assert hotter["heat"]["spread_m"] >= brief["heat"]["spread_m"]
    assert warm >= cold or hotter["heat"]["minutes"] > brief["heat"]["minutes"]


def test_resolve_address_auto_vibe():
    m = live_geometry.resolve_address("8866 Gulf Freeway")
    assert m["auto"] and m["hit"]["building_id"] == BID and m["hit"]["score"] >= directory.GOOD_SCORE


def test_live_session_nests_geometry_and_match():
    sid = client.post("/live/sessions", json={"building_id": BID, "use_llm": False}).json()["session_id"]
    lines = [
        {"role": "dispatcher", "text": "What is the address?"},
        {"role": "caller", "text": "8866 Gulf Freeway, fire in the kitchen, my coworker is trapped in the kitchen"},
    ]
    r = client.post(f"/live/sessions/{sid}/utterances", json={"utterances": lines}).json()
    assert r["extracted"]
    assert r["building_match"]["auto"] is True
    assert r["briefing"]["heat"]["rooms"]
    assert r["briefing"]["rescue"]["people"][0]["entry"]["polyline"]


def test_session_rebind_keeps_utterances():
    sid = client.post("/live/sessions", json={"building_id": "costar-350372", "use_llm": False}).json()["session_id"]
    lines = [{"role": "caller", "text": "Fire at 8866 Gulf Freeway, someone trapped in an office"}]
    client.post(f"/live/sessions/{sid}/utterances", json={"utterances": lines})
    r = client.post(f"/live/sessions/{sid}/building", json={"building_id": BID}).json()
    assert r["building_id"] == BID
    assert r["utterances"] and r["briefing"]["building_id"] == BID


def test_tick_updates_minutes():
    sid = client.post("/live/sessions", json={"building_id": BID, "use_llm": False}).json()["session_id"]
    lines = [{"role": "caller", "text": "Kitchen fire, coworker trapped in the kitchen"}]
    client.post(f"/live/sessions/{sid}/utterances", json={"utterances": lines})
    t = client.post(f"/live/sessions/{sid}/tick").json()
    assert "heat" in (t.get("briefing") or {})
    assert t["minutes"] >= 0


def test_rescue_plan_accepts_risk_bump():
    d = {"floor": 1, "fire_room_ids": ["r-2qdmc5"], "trapped": [
        {"description": "x", "room_id": "r-2qdmc5", "near": "center", "confidence": 0.7}]}
    heat = rescue.build_heat(BID, d, 0)
    a = rescue.plan(BID, d, heat)
    b = rescue.plan(BID, d, heat, risk_bump=2.0, window_extra_s=90)
    assert a["people"] and b["people"]
