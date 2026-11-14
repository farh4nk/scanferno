import json

from agent import ask, briefing
from data import cache
from dispatch.extract import extract, rules_extract
from dispatch.locate import locate, side_from_text
from data import layers


def call(bid, cid):
    return json.loads((cache.FIXTURES / bid / "calls" / f"{cid}.json").read_text())["transcript"]


def test_clean_call():
    d = extract(call("costar-239873", "call-1"), "costar-239873", use_llm=False)
    assert d["floor"] == 1
    assert d["side"] == "C"
    assert "black smoke" in d["conditions"]
    assert d["trapped"][0]["description"] == "coworker"
    labels = {c["label"] for c in d["trapped"][0]["room_candidates"][:2]}
    assert labels == {"Office 101", "Office 111"}


def test_messy_call_corrections():
    d = extract(call("costar-239873", "call-2-messy"), "costar-239873", use_llm=False)
    assert d["floor"] == 1
    assert d["side"] == "D"
    assert {"floor", "side", "trapped"} <= set(d["corrected"])
    assert "corner office" in d["trapped"][0]["near"]
    assert "oxygen cylinders" in d["hazards"]


def test_caller_location_does_not_move_fire_side():
    t = [{"t": 0, "speaker": "caller", "text": "Smoke is coming out the back."},
         {"t": 1, "speaker": "dispatcher", "text": "Where are you right now?"},
         {"t": 2, "speaker": "caller", "text": "I'm in the front parking lot."}]
    assert rules_extract(t)["side"] == "C"


def test_needs_assist():
    d = extract(call("costar-350372", "call-1"), "costar-350372", use_llm=False)
    assert d["trapped"][0]["needs_assist"] is True
    assert d["trapped"][0]["room_id"]


def test_side_words():
    assert side_from_text("east side", "S") == "D"
    assert side_from_text("charlie side") == "C"
    assert side_from_text("in the back") == "C"


def test_locate_open_area_and_labels():
    fp = layers.floorplan("costar-23553")
    assert locate("the big open office on the west side", fp)[0]["label"].startswith("Open area")
    assert locate("storage room by the hallway", fp)[0]["label"].startswith("Storage")
    fp = layers.floorplan("costar-239873")
    assert locate("Office 110", fp)[0]["room_id"] == "r-tx2gws"


def test_briefing_contract():
    d = extract(call("costar-239873", "call-1"), "costar-239873", use_llm=False)
    b = briefing.build("costar-239873", d, use_llm=False)
    for key in ("summary", "hazards", "entry_points", "ladder_positions", "search_plan", "exit_routes", "trapped", "images"):
        assert key in b
    assert b["search_plan"][0]["room_id"] == d["trapped"][0]["room_id"]
    assert {h["source"] for h in b["hazards"]} >= {"costar", "vexcel", "matterport", "dispatch"}
    assert any(e.get("role") == "search" for e in b["entry_points"])


def test_ask_rules():
    r = ask.ask("costar-239873", "Nearest exit from Office 104?", use_llm=False)
    assert "Office 104" in r["answer"] and r["highlight"]["polylines"]
    r = ask.ask("costar-239873", "What's on the roof?", use_llm=False)
    assert "Roof" in r["answer"]
