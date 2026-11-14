"""Dispatch facts for the briefing: Gemini extraction with an offline rule-based fallback, mapped to rooms.

    extract(transcript, building_id)

Uses dispatch/extract.py (Gemini) when GEMINI_API_KEY is set; otherwise, or if Gemini fails, the rule
extractor here, so the demo never stalls. Either way, phrases are then mapped onto the floor plan with
dispatch/locate.py: "my coworker by the kitchen" -> trapped[0].room_id + candidates, "back of the
building" -> side C -> fire_room_ids. In the rules, the latest statement wins and the field is marked
corrected with lower confidence; hedged statements ("I think", "maybe") also lower confidence.
"""
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
               r"went back|inside|(?:is|are|was|were) in the|'s in the)")
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
        if (line.get("speaker") or line.get("role")) == "dispatcher":
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
        asked_fire = (re.search(r"\b(?:fire|smoke|flames|which side|where on|where in)\b", last_q)
                      and not re.search(r"\bwhere are you\b|\baddress\b|\banyone\b", last_q))
        side = side_from_text(fire_bit.group(1) if fire_bit else (low if asked_fire else ""), front)
        if side:
            _set(rec, "side", side, 0.85, low)
        loc = _location_phrase(fire_bit.group(1)) if fire_bit else (_location_phrase(low) if asked_fire else None)
        if loc and not re.fullmatch(r"\w+ the \w+ floor", loc):
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


def llm_available() -> bool:
    return bool(os.getenv("GEMINI_API_KEY"))


def normalize(record: dict, building_id: str) -> dict:
    """Bring an extract.extract() record into the shape the briefing uses: trapped[].near from location,
    raw Matterport room ids mapped to floorplan ids, `changed` mirrored as `corrected`."""
    rec = {**_empty(), **record}
    by_mp = {r["matterport_id"]: r["id"] for r in layers.floorplan(building_id)["rooms"]}
    for p in rec.get("trapped") or []:
        p.setdefault("near", p.get("location"))
        if p.get("room_id") in by_mp:
            p["room_id"] = by_mp[p["room_id"]]
    rec["corrected"] = rec.get("corrected") or [f for f in rec.get("changed") or [] if record.get(f) is not None]
    return rec


def extract(transcript: list[dict], building_id: str | None = None, use_llm: bool | None = None,
            previous: dict | None = None) -> dict:
    """Dispatch record for the briefing. Gemini (dispatch/extract.py) when a key is set, otherwise rules.
    transcript lines may be {role, text} (pipeline) or {speaker, t, text} (scripts)."""
    lines = [{"role": l.get("role") or l.get("speaker") or "caller", "speaker": l.get("speaker") or l.get("role") or "caller",
              "t": l.get("t", l.get("start", 0)), "text": l["text"]} for l in transcript]
    front = layers.building(building_id).get("front", "S") if building_id else "S"
    rec, source = None, "rules"
    if use_llm if use_llm is not None else llm_available():
        try:
            from . import extract as gemini_extract
            prev = {k: v for k, v in (previous or {}).items() if k not in ("transcript", "room_candidates", "fire_candidates")} or None
            rec = gemini_extract.extract(lines, building_id, prev)
            rec = normalize(rec, building_id) if building_id else rec
            source = "gemini"
        except Exception as e:  # keep the demo moving on rate limits / network blips
            rec, source = None, f"rules (gemini failed: {type(e).__name__})"
    if rec is None:
        rec = rules_extract(lines, front)
    rec["extractor"] = source
    rec["transcript"] = transcript
    if building_id:
        rec["building_id"] = building_id
        resolve_rooms(rec, building_id)
    return rec


def resolve_rooms(rec: dict, building_id: str) -> dict:
    """Attach room_id + candidates to trapped people and the fire location. A room the extractor already
    matched stays first; the locator adds alternates."""
    fp, nav = layers.floorplan(building_id), layers.nav(building_id)
    front = layers.building(building_id).get("front", "S")
    labels = {r["id"]: r["label"] for r in fp["rooms"]}
    for p in rec.get("trapped") or []:
        cands = locate(p.get("near") or "", fp, nav, front)
        if p.get("room_id") in labels:
            matched = {"room_id": p["room_id"], "label": labels[p["room_id"]], "confidence": p.get("confidence", 0.8),
                       "why": p.get("room_match") or "matched by extractor"}
            cands = [matched] + [c for c in cands if c["room_id"] != p["room_id"]]
        else:
            p["room_id"] = cands[0]["room_id"] if cands else None
            if cands:
                p["confidence"] = round(min(p.get("confidence", 0.7), 0.4 + cands[0]["confidence"]), 2)
        p["room_candidates"] = cands
    fire_text = " ".join(x for x in (rec.get("fire_location"), {"A": "front", "C": "back", "B": "left side", "D": "right side"}.get(rec.get("side") or "")) if x)
    cands = locate(fire_text, fp, nav, front) if fire_text else []
    if not cands and rec.get("side"):
        cands = [{"room_id": r["id"], "label": r["label"], "confidence": 0.3, "why": f"on side {rec['side']}"}
                 for r in fp["rooms"] if r.get("side") == rec["side"]][:3]
    rec["fire_room_ids"] = [c["room_id"] for c in cands[:2]]
    rec["fire_candidates"] = cands
    return rec

