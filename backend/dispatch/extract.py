"""Turn a (partial) dispatch call transcript into the structured dispatch record.

Called after each caller utterance with the previous record, so facts build up live and
corrections ("second floor, no, third") overwrite earlier guesses. Room matching uses the
building's Matterport rooms so "the break room" becomes a real room id.
"""
import json

from agent import llm
from data import cache

NULLABLE_STR = {"type": ["string", "null"]}
CONF = {"type": "number", "minimum": 0, "maximum": 1}

SCHEMA = {
    "type": "object",
    "properties": {
        "address": NULLABLE_STR,
        "cross_street": NULLABLE_STR,
        "floor": {"type": ["integer", "null"]},
        "side": {"type": ["string", "null"], "description": "Fireground side: A front/street, B left, C rear, D right"},
        "fire_location": {**NULLABLE_STR, "description": "Where the fire is, in the caller's words, condensed"},
        "conditions": {"type": "array", "items": {"type": "string"}, "description": "e.g. black smoke, flames visible"},
        "trapped": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "description": {"type": "string"},
                    "location": NULLABLE_STR,
                    "floor": {"type": ["integer", "null"]},
                    "room_id": {**NULLABLE_STR, "description": "id from the scanned rooms list, only if the location clearly matches"},
                    "confidence": CONF,
                },
                "required": ["description", "location", "floor", "room_id", "confidence"],
            },
        },
        "hazards": {"type": "array", "items": {"type": "string"}},
        "caller_location": NULLABLE_STR,
        "confidence": {
            "type": "object",
            "properties": {k: CONF for k in ("address", "floor", "side", "trapped", "hazards")},
            "required": ["address", "floor", "side", "trapped", "hazards"],
        },
        "changed": {"type": "array", "items": {"type": "string"}, "description": "Top-level fields that differ from the previous record"},
    },
    "required": ["address", "cross_street", "floor", "side", "fire_location", "conditions", "trapped",
                 "hazards", "caller_location", "confidence", "changed"],
}

SYSTEM = """You are a fire dispatch analyst listening to a live 911 call. Maintain a structured incident record.

Rules:
- Record only what the caller said or clearly implied. Never invent details.
- Callers panic and correct themselves. The latest statement wins; lower confidence when the caller is unsure.
- Keep facts from the previous record unless the new transcript contradicts them.
- side: A = street front, C = rear ("back of the building"), B and D = left and right as seen from the street. null if unclear.
- room_id: pick from the scanned rooms list only when the description clearly fits a room type
  (e.g. "break room" or "kitchen" -> a Kitchen room). Otherwise null. Don't guess between several similar rooms.
- hazards: things dangerous to firefighters (gas, chemicals, oxygen tanks, hoarding, structural damage).
- changed: list the top-level fields whose values differ from the previous record (all non-empty fields if there is none)."""


def building_context(building_id: str) -> dict:
    """Compact facts the model needs: tenants by floor/suite and the scanned rooms."""
    costar = cache.load_json(building_id, "costar.json") or {}
    vector = cache.load_json(building_id, "matterport_vector.json") or {}
    rooms = []
    for r in vector.get("rooms") or []:
        pts = [v["position"] for e in (r.get("boundary") or {}).get("edges") or [] for v in e.get("vertices") or []]
        if not pts:
            continue
        xs, ys = [p["x"] for p in pts], [p["y"] for p in pts]
        types = [c["label"] for c in r.get("classifications") or []]
        if types == ["Void"]:
            continue
        rooms.append({
            "room_id": r["id"],
            "type": ", ".join(types) or "Other",
            "label": r.get("label") or None,
            "size_m": [round(max(xs) - min(xs), 1), round(max(ys) - min(ys), 1)],
            "center_m": [round(sum(xs) / len(xs), 1), round(sum(ys) / len(ys), 1)],
        })
    tenants = [
        {k: t[k] for k in ("name", "industry", "floor", "suite")}
        for t in costar.get("tenants") or [] if t.get("name") != "Unknown tenant"
    ]
    return {
        "building": {k: costar.get(k) for k in ("building_name", "address", "stories", "property_type", "year_built")},
        "tenants": tenants,
        "scanned_rooms": rooms,
    }


# Caller words -> Matterport room type. Used only when exactly one scanned room has that type.
ROOM_SYNONYMS = {
    "Kitchen": ["break room", "breakroom", "kitchen", "lunch room", "lunchroom", "kitchenette", "pantry"],
    "Hallway": ["hallway", "hall", "corridor"],
    "Bathroom": ["bathroom", "restroom", "washroom", "toilet"],
    "Conference Room": ["conference room", "meeting room", "boardroom"],
    "Storage": ["storage", "supply room", "closet"],
    "Stairwell": ["stairwell", "stairs", "staircase"],
    "Lobby": ["lobby", "reception", "front desk"],
}


def match_rooms(record: dict, rooms: list[dict]) -> dict:
    """Fill trapped[].room_id deterministically when the words name a room type with exactly one scanned room."""
    by_type: dict[str, list[str]] = {}
    for r in rooms:
        for t in r["type"].split(", "):
            by_type.setdefault(t, []).append(r["room_id"])
    valid = {r["room_id"] for r in rooms}
    for person in record.get("trapped") or []:
        if person.get("room_id") not in valid:
            person["room_id"] = None
        if person["room_id"]:
            continue
        words = f"{person.get('location') or ''} {person.get('description') or ''}".lower()
        for rtype, phrases in ROOM_SYNONYMS.items():
            if any(p in words for p in phrases) and len(by_type.get(rtype, [])) == 1:
                person["room_id"] = by_type[rtype][0]
                person["room_match"] = f"'{next(p for p in phrases if p in words)}' -> only {rtype} in scan"
                break
    return record


def extract(transcript: list[dict], building_id: str | None = None, previous: dict | None = None) -> dict:
    """transcript: [{role: dispatcher|caller, text}]. Returns the dispatch record (see docs/CONTRACTS.md)."""
    lines = "\n".join(f"{u['role'].upper()}: {u['text']}" for u in transcript)
    ctx = building_context(building_id) if building_id else None
    parts = []
    if ctx:
        parts.append("Building (from CoStar + Matterport):\n" + json.dumps(ctx))
    parts.append("Previous record:\n" + (json.dumps(previous) if previous else "none"))
    parts.append("Transcript so far:\n" + lines)
    record = json.loads(llm.generate("\n\n".join(parts), system=SYSTEM, json_schema=SCHEMA))
    record["changed"] = [f for f in record.get("changed") or [] if f not in ("changed", "confidence")]
    return match_rooms(record, ctx["scanned_rooms"]) if ctx else record
