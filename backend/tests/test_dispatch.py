from agent import ask, briefing
from data import cache, layers
from dispatch.facts import extract, normalize, resolve_rooms, rules_extract
from dispatch.locate import locate, side_from_text


def script(cid):
    s = cache.load_json("calls", cid, "script.json")
    return s["lines"], s["building_id"]


def test_clean_call():
    d = extract(*script("vibe-1-clean"), use_llm=False)
    assert d["floor"] == 3 and d["side"] == "C"
    assert "black smoke" in d["conditions"] and "oxygen cylinders" in d["hazards"]
    assert d["trapped"][0]["description"] == "coworker"
    assert d["trapped"][0]["room_candidates"][0]["label"].startswith("Kitchen")
    assert "fire_location" not in d["corrected"]


def test_messy_call_corrections():
    d = extract(*script("vibe-2-messy"), use_llm=False)
    assert d["floor"] == 3 and "floor" in d["corrected"]
    assert d["side"] == "B"
    assert "copy machine" in d["trapped"][0]["near"]
    assert "possible gas leak" in d["hazards"]


def test_cached_gemini_record_maps_to_floorplan_ids():
    bid = "costar-239873"
    rec = cache.load_json("calls", "vibe-1-clean", "timeline.json")["timeline"][-1]["record"]
    d = resolve_rooms(normalize(rec, bid), bid)
    ids = {r["id"] for r in layers.floorplan(bid)["rooms"]}
    assert d["trapped"][0]["room_id"] in ids and d["fire_room_ids"]


def test_caller_location_does_not_move_fire_side():
    t = [{"role": "caller", "text": "Smoke is coming out the back."},
         {"role": "dispatcher", "text": "Where are you right now?"},
         {"role": "caller", "text": "I'm in the front parking lot."}]
    assert rules_extract(t)["side"] == "C"


def test_needs_assist():
    d = extract(*script("bellaire-1-patient"), use_llm=False)
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
    d = extract(*script("vibe-1-clean"), use_llm=False)
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


def test_locate_reads_spoken_room_numbers():
    from data import layers
    from dispatch.locate import locate, spoken_room_numbers

    assert spoken_room_numbers("exam room one oh four") == "exam room 104"
    assert spoken_room_numbers("office one hundred and four") == "office 104"
    assert spoken_room_numbers("storage room number one-twenty by the front") == "storage room 120 by the front"
    assert spoken_room_numbers("the office by the kitchen") == "the office by the kitchen"
    bid = "costar-350372"
    fp, nav = layers.floorplan(bid), layers.nav(bid)
    assert locate("exam room one oh four", fp, nav)[0]["label"] == "Office 104"
    assert locate("storage room one twenty", fp, nav)[0]["label"] == "Storage 120"
