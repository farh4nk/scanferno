"""Dispatch transcript -> structured facts (dispatch.json in docs/CONTRACTS.md), updated as lines arrive.

    extract(transcript, building)   transcript = [{"t": sec, "speaker": "caller"|"dispatcher", "text": ...}]

Uses Gemini when GEMINI_API_KEY is set, otherwise a rule-based extractor (also the fallback if the LLM
call fails, so the demo never stalls). Either way, phrases are then mapped onto the floor plan:
"my coworker by the kitchen" -> trapped[0].room_id, "back of the building" -> side C.
Callers correct themselves; the latest statement wins and the field is marked corrected with lower
confidence. Hedged statements ("I think", "maybe") also lower confidence.
"""
import json
import os
import re

from data import layers

from .locate import locate, side_from_text

ORDINALS = {"first": 1, "1st": 1, "ground": 1, "second": 2, "2nd": 2, "third": 3, "3rd": 3,
            "fourth": 4, "4th": 4, "fifth": 5, "5th": 5, "sixth": 6, "6th": 6}
CONDITIONS = ["black smoke", "heavy smoke", "white smoke", "gray smoke", "grey smoke", "smoke", "flames",
              "explosion", "sparks", "alarm going off", "sprinklers going"]
HAZARDS = {
    "gas": "possible gas leak", "propane": "propane", "oxygen": "oxygen cylinders", "chemical": "chemicals",
    "solvent": "solvents", "paint": "paint / flammable liquids", "gasoline": "gasoline", "fuel": "fuel",
    "batter": "lithium batteries", "generator": "generator", "power line": "downed power lines",
    "ammonia": "ammonia", "tanks": "pressurized tanks", "aerosol": "aerosol cans",
}
PERSON = (r"(?:coworker|co-worker|boss|manager|receptionist|patient|patients|mom|mother|dad|father|wife|husband|"
          r"son|daughter|kid|kids|child|children|baby|man|woman|guy|lady|someone|somebody|people|person|friend|"
          r"employee|employees|customer|customers|nurse|doctor|janitor|grandma|grandpa)")
TRAPPED_CUE = (r"(?:still in|still inside|trapped|stuck|can'?t get out|in there|didn'?t come out|hasn'?t come out|"
               r"inside|(?:is|are|was|were) in the)")
CORRECTION = r"\b(?:no wait|wait|actually|sorry|i mean|no,? no|correction|not the)\b"
HEDGE = r"\b(?:i think|maybe|might|not sure|probably|i guess|could be)\b"
ASSIST = r"\b(?:wheelchair|walker|crutches|bedridden|can'?t walk|disabled|blind|deaf|elderly|baby|infant|on oxygen|unconscious|passed out)\b"
NUM_WORDS = {"one": 1, "two": 2, "three": 3, "four": 4, "five": 5, "a couple": 2, "a few": 3, "several": 4}


def _empty() -> dict:
    return {"address": None, "floor": None, "side": None, "fire_location": None, "conditions": [],
            "trapped": [], "hazards": [], "caller_location": None, "confidence": {}, "corrected": []}


def _set(rec: dict, field: str, value, conf: float, text: str):
    if value is None:
        return
    if re.search(HEDGE, text, re.I):
        conf = min(conf, 0.55)
    prev = rec.get(field)
    if prev is not None and prev != value:
        if field not in rec["corrected"]:
            rec["corrected"].append(field)
        conf = min(conf, 0.8)
    elif prev == value:
        conf = min(0.98, max(conf, rec["confidence"].get(field, 0)) + 0.05)
    rec[field] = value
    rec["confidence"][field] = round(conf, 2)


def _location_phrase(text: str) -> str | None:
    m = re.search(r"\b((?:in|by|near|next to|beside|at|on) (?:the|a|an|his|her|their|my|our) [^,.;!?]+)", text, re.I)
    return m.group(1).strip() if m else None


def _after_correction(text: str) -> str:
    parts = re.split(CORRECTION, text)
    return re.sub(r"^[\s,]+", "", parts[-1]).strip(" .!?")


def rules_extract(transcript: list[dict], front: str = "S") -> dict:
    rec = _empty()
    last_q = ""
    for line in transcript:
        text = line["text"]
        low = text.lower()
        if line.get("speaker") == "dispatcher":
            last_q = low
            continue
        correcting = bool(re.search(CORRECTION, low))

        m = re.search(r"\b(\d{2,6})\s+([a-z0-9 .]+?(?:st|street|rd|road|ave|avenue|blvd|boulevard|fwy|freeway|dr|drive|ln|lane|way|pkwy|parkway|hwy|highway))\b", low)
        if m:
            _set(rec, "address", f"{m.group(1)} {m.group(2).title()}", 0.9, low)

        floors = re.findall(r"\b(first|second|third|fourth|fifth|sixth|ground|1st|2nd|3rd|4th|5th|6th)\s+floor\b", low)
        if not floors and "floor" in last_q:
            floors = re.findall(r"\b(first|second|third|fourth|fifth|sixth|ground|1st|2nd|3rd|4th|5th|6th)\b", low)
        for f in floors:
            _set(rec, "floor", ORDINALS[f], 0.9 if not correcting else 0.8, low)

        fire_bit = re.search(r"((?:fire|smoke|flames)[^.?!]*?\b(?:in|at|from|on|coming out)\b[^.?!]*)", low)
        asked_fire = re.search(r"\b(?:fire|smoke|flames|which side)\b", last_q) and not re.search(r"\bwhere are you\b", last_q)
        side = side_from_text(fire_bit.group(1) if fire_bit else (low if asked_fire else ""), front)
        if side:
            _set(rec, "side", side, 0.85, low)
        if fire_bit:
            loc = _location_phrase(fire_bit.group(1))
            if loc:
                _set(rec, "fire_location", loc, 0.75, low)

        for c in CONDITIONS:
            if re.search(rf"\b{c}\b", low) and not any(c in x for x in rec["conditions"]):
                rec["conditions"].append(c)
                rec["confidence"]["conditions"] = 0.9

        for key, label in HAZARDS.items():
            if key == "tanks" and re.search(r"oxygen|propane", low):
                continue
            if key in low and label not in rec["hazards"] and not re.search(rf"\bno {key}", low):
                rec["hazards"].append(label)
                rec["confidence"]["hazards"] = 0.8 if not re.search(HEDGE, low) else 0.55

        pm = re.search(rf"\b((?:my |a |the |two |three |a couple of |some )?{PERSON})\b[^.?!]*?\b{TRAPPED_CUE}\b[^.?!]*", low)
        if pm or (re.search(TRAPPED_CUE, low) and re.search(PERSON, low)):
            sentence = pm.group(0) if pm else low
            who = (pm.group(1) if pm else re.search(PERSON, low).group(0)).strip()
            count = next((n for w, n in NUM_WORDS.items() if re.search(rf"\b{w}\b", who)), 1)
            sentence, who = sentence.replace(who, re.sub(r"^(?:my|a|the|some)\s+", "", who), 1), re.sub(r"^(?:my|a|the|some)\s+", "", who)
            near = (_location_phrase(sentence.split(who, 1)[-1]) or _location_phrase(low.split(who, 1)[-1])
                    or _location_phrase(sentence))
            conf = 0.55 if re.search(HEDGE, low) else 0.75
            assist = bool(re.search(ASSIST, low))
            same = next((p for p in rec["trapped"] if p["description"] == who or correcting), None)
            if same:
                same.update({"near": near or same.get("near"), "confidence": min(conf, 0.75) if correcting else conf})
                same["needs_assist"] = same.get("needs_assist") or assist
                if correcting and "trapped" not in rec["corrected"]:
                    rec["corrected"].append("trapped")
            else:
                rec["trapped"].append({"description": who, "count": count, "near": near, "floor": rec["floor"],
                                       "confidence": conf, "needs_assist": assist})
            rec["confidence"]["trapped"] = max(p["confidence"] for p in rec["trapped"])
        elif re.search(r"\b(?:everyone|everybody)(?: is| got| made it)? out\b|\bno one(?:'s| is) inside\b", low):
            rec["trapped"] = []
            rec["confidence"]["trapped"] = 0.8
        elif correcting and rec["trapped"] and not fire_bit and re.search(r"\b(?:office|room|kitchen|hall|closet|bathroom|lobby|side)\b", low):
            rec["trapped"][-1].update({"near": _after_correction(low), "confidence": 0.7})
            if "trapped" not in rec["corrected"]:
                rec["corrected"].append("trapped")
        elif rec["trapped"] and re.search(ASSIST, low):
            rec["trapped"][-1]["needs_assist"] = True

        cm = re.search(r"\bi'?m (?:now )?((?:outside|in the|across|on the|at the|out front|out back)[^,.;!?]*)", low)
        if cm:
            _set(rec, "caller_location", cm.group(1).strip(), 0.85, low)
    for p in rec["trapped"]:
        p["floor"] = p.get("floor") or rec["floor"]
    return rec


LLM_SCHEMA = {
    "type": "object",
    "properties": {
        "address": {"type": "string", "description": "empty if not said"},
        "floor": {"type": "integer", "description": "0 if not said"},
        "side": {"type": "string", "enum": ["A", "B", "C", "D", ""]},
        "fire_location": {"type": "string", "description": "caller's words for where the fire is, empty if not said"},
        "conditions": {"type": "array", "items": {"type": "string"}},
        "trapped": {"type": "array", "items": {"type": "object", "properties": {
            "description": {"type": "string"}, "count": {"type": "integer"},
            "near": {"type": "string", "description": "caller's words for where they are, empty if unknown"},
            "floor": {"type": "integer"}, "confidence": {"type": "number"},
            "needs_assist": {"type": "boolean", "description": "wheelchair, infant, unconscious, etc."}},
            "required": ["description", "near", "confidence"]}},
        "hazards": {"type": "array", "items": {"type": "string"}},
        "caller_location": {"type": "string"},
        "confidence": {"type": "object", "properties": {k: {"type": "number"} for k in ("address", "floor", "side", "trapped", "hazards")}},
        "corrected": {"type": "array", "items": {"type": "string"}, "description": "fields the caller changed mid-call"},
    },
    "required": ["floor", "side", "conditions", "trapped", "hazards", "confidence", "corrected"],
}

LLM_SYSTEM = """You turn a live 911 fire call transcript into structured facts for firefighters.
Only use what the caller actually said. Callers panic, repeat and correct themselves: the latest statement wins,
list corrected fields in "corrected" and lower their confidence. Hedged statements ("I think") get confidence <= 0.6.
Sides: A = street front, B = left when facing the front, C = rear/back, D = right. The front faces {front}.
Keep "near" and "fire_location" in the caller's own words (e.g. "the office by the kitchen"); do not invent rooms.
If everyone is out, trapped is an empty list."""


def llm_extract(transcript: list[dict], front: str = "S") -> dict:
    from agent import llm
    lines = "\n".join(f"[{l.get('t', 0):>5.1f}s] {l.get('speaker', 'caller')}: {l['text']}" for l in transcript)
    out = json.loads(llm.generate(f"Transcript so far:\n{lines}", system=LLM_SYSTEM.format(front=front), json_schema=LLM_SCHEMA))
    rec = {**_empty(), **{k: (v if v not in ("", 0) else None) for k, v in out.items()}}
    for k in ("conditions", "trapped", "hazards", "corrected"):
        rec[k] = rec.get(k) or []
    for p in rec["trapped"]:
        p["near"] = p.get("near") or None
        p["floor"] = p.get("floor") or rec["floor"]
    rec["confidence"] = {k: v for k, v in (rec.get("confidence") or {}).items() if v}
    return rec


def llm_available() -> bool:
    return bool(os.getenv("GEMINI_API_KEY"))


def extract(transcript: list[dict], building_id: str | None = None, use_llm: bool | None = None) -> dict:
    b = layers.building(building_id) if building_id else {}
    front = b.get("front", "S")
    rec, source = None, "rules"
    if (use_llm if use_llm is not None else llm_available()):
        try:
            rec, source = llm_extract(transcript, front), "gemini"
        except Exception as e:  # keep the demo moving on rate limits / network blips
            rec, source = None, f"rules (gemini failed: {type(e).__name__})"
    if rec is None:
        rec = rules_extract(transcript, front)
    rec["extractor"] = source
    rec["transcript"] = transcript
    if building_id:
        rec["building_id"] = building_id
        resolve_rooms(rec, building_id)
    return rec


def resolve_rooms(rec: dict, building_id: str) -> dict:
    """Attach room_id + candidates to trapped people and the fire location."""
    fp, nav = layers.floorplan(building_id), layers.nav(building_id)
    front = layers.building(building_id).get("front", "S")
    for p in rec.get("trapped") or []:
        cands = locate(p.get("near") or "", fp, nav, front)
        p["room_id"] = cands[0]["room_id"] if cands else None
        p["room_candidates"] = cands
        if cands:
            p["confidence"] = round(min(p.get("confidence", 0.7), 0.4 + cands[0]["confidence"]), 2)
    fire_text = " ".join(x for x in (rec.get("fire_location"), {"A": "front", "C": "back", "B": "left side", "D": "right side"}.get(rec.get("side") or "")) if x)
    cands = locate(fire_text, fp, nav, front) if fire_text else []
    if not cands and rec.get("side"):
        cands = [{"room_id": r["id"], "label": r["label"], "confidence": 0.3, "why": f"on side {rec['side']}"}
                 for r in fp["rooms"] if r.get("side") == rec["side"]][:3]
    rec["fire_room_ids"] = [c["room_id"] for c in cands[:2]]
    rec["fire_candidates"] = cands
    return rec
