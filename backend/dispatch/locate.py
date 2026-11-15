"""Map a caller's vague words to rooms on the floor plan.

"the office by the kitchen", "storage room in the back", "the big open office", "Office 104".
Scoring per room: explicit label/number match > room type match > next to a matching landmark (shares a
wall or a door with it), plus bonuses for the right building side, "corner", and "big/open" (area).
Returns ranked candidates with a confidence that drops when several rooms tie, so the briefing can say
"likely Office 101 (or Office 111)".
"""
import re

from shapely.geometry import Polygon

from geometry.navgraph import NavGraph
from geometry.sides import side_map

# phrase -> room types it means; matched longest phrase first, so "open office" never also means "office"
LANDMARKS = {
    "open office": ["open_area"], "open area": ["open_area"], "cubicles": ["open_area"], "bullpen": ["open_area"],
    "warehouse": ["open_area"], "showroom": ["open_area"], "sales floor": ["open_area"],
    "break room": ["kitchen"], "breakroom": ["kitchen"], "kitchen": ["kitchen"], "cafeteria": ["kitchen"],
    "bathroom": ["restroom"], "restroom": ["restroom"], "toilet": ["restroom"],
    "storage": ["storage"], "closet": ["storage"], "supply": ["storage"], "stock room": ["storage"],
    "file room": ["storage"], "server room": ["storage"], "mechanical": ["storage"],
    "hallway": ["hallway"], "hall": ["hallway"], "corridor": ["hallway"],
    "elevator": ["hallway", "lobby"], "stairs": ["stairwell", "hallway"], "stairwell": ["stairwell", "hallway"],
    "lobby": ["lobby", "hallway"], "reception": ["lobby", "hallway"], "front desk": ["lobby", "hallway"],
    "entrance": ["lobby", "hallway"],
    "exam room": ["office"], "meeting room": ["office"], "conference": ["office"], "office": ["office"],
}
NEAR_WORDS = r"(?:by|near|next to|beside|across from|close to|outside)"
SIDE_WORDS = {"back": "C", "rear": "C", "behind": "C", "front": "A", "street": "A", "left side": "B", "right side": "D"}
COMPASS_WORDS = {"north": "N", "south": "S", "east": "E", "west": "W"}


def side_from_text(text: str, front: str = "S") -> str | None:
    t = text.lower()
    m = re.search(r"\b(alpha|bravo|charlie|delta)\b|\bside ([abcd])\b", t)
    if m:
        return (m.group(1) or m.group(2))[0].upper()
    for word, c in COMPASS_WORDS.items():
        if re.search(rf"\b{word}\b", t):
            return side_map(front)[c]
    for word, s in SIDE_WORDS.items():
        if re.search(rf"\b{word}\b", t):
            return s
    return None


def _types_in(text: str) -> list[str]:
    out = []
    for word in sorted(LANDMARKS, key=len, reverse=True):
        pattern = rf"\b{word}s?\b"
        if re.search(pattern, text):
            out.extend(t for t in LANDMARKS[word] if t not in out)
            text = re.sub(pattern, " ", text)
    return out


def neighbors(fp: dict) -> dict[str, set]:
    """Rooms that share a door or a wall."""
    out = {r["id"]: set() for r in fp["rooms"]}
    for d in fp["doors"]:
        a, b = d["rooms"]
        if a in out and b in out:
            out[a].add(b)
            out[b].add(a)
    polys = {r["id"]: Polygon(r["polygon"]) for r in fp["rooms"]}
    ids = list(polys)
    for i, a in enumerate(ids):
        for b in ids[i + 1:]:
            if polys[a].distance(polys[b]) < 0.4 and polys[a].buffer(0.4).intersection(polys[b].exterior).length > 1.0:
                out[a].add(b)
                out[b].add(a)
    return out


_DIGIT = {"zero": 0, "oh": 0, "one": 1, "two": 2, "three": 3, "four": 4, "five": 5, "six": 6, "seven": 7, "eight": 8, "nine": 9}
_TEENS = {"ten": 10, "eleven": 11, "twelve": 12, "thirteen": 13, "fourteen": 14, "fifteen": 15, "sixteen": 16, "seventeen": 17,
          "eighteen": 18, "nineteen": 19, "twenty": 20, "thirty": 30, "forty": 40, "fifty": 50, "sixty": 60, "seventy": 70,
          "eighty": 80, "ninety": 90}
_NUM_WORD = "|".join(sorted([*_DIGIT, *_TEENS, "hundred", "and"], key=len, reverse=True))
_ROOM_NUMBER = re.compile(rf"\b(room|office|suite|storage|kitchen|exam room|closet)(?:\s+number)?((?:[\s-]+(?:{_NUM_WORD})\b){{2,4}})")


def _spoken_number(words: list[str]) -> int | None:
    """"one oh four", "one zero four", "one hundred four", "one twenty" -> 104, 104, 104, 120."""
    words = [w for w in words if w != "and"]
    if len(words) >= 2 and words[1] == "hundred" and words[0] in _DIGIT:
        rest = words[2:]
        extra = 0 if not rest else (_TEENS.get(rest[0]) if len(rest) == 1 and rest[0] in _TEENS else _DIGIT.get(rest[0]) if len(rest) == 1 else None)
        return None if extra is None else _DIGIT[words[0]] * 100 + extra
    if len(words) == 2 and words[0] in _DIGIT and words[1] in _TEENS and words[0] != "oh":
        return _DIGIT[words[0]] * 100 + _TEENS[words[1]]  # "one twenty", "two ten"
    if 2 <= len(words) <= 4 and all(w in _DIGIT for w in words):
        return int("".join(str(_DIGIT[w]) for w in words))
    return None


def spoken_room_numbers(text: str) -> str:
    """Rewrite spoken room numbers after a room word as digits, so "exam room one oh four" matches Office 104."""
    def fix(m):
        n = _spoken_number(re.split(r"[\s-]+", m.group(2).strip()))
        return m.group(0) if n is None or n < 10 else f"{m.group(1)} {n}"
    return _ROOM_NUMBER.sub(fix, text)


def locate(phrase: str, fp: dict, nav: NavGraph | None = None, front: str = "S", top: int = 3) -> list[dict]:
    if not phrase:
        return []
    text = spoken_room_numbers(phrase.lower())
    rooms = fp["rooms"]
    by_id = {r["id"]: r for r in rooms}

    m = re.search(r"\b(?:room|office|suite|storage|kitchen|exam)\s*#?\s*(\d{2,4}[a-z]?)\b", text)
    if m:
        hits = [r for r in rooms if r["label"].lower().endswith(" " + m.group(1))]
        if hits:
            return [{"room_id": hits[0]["id"], "label": hits[0]["label"], "confidence": 0.95, "why": f"label match '{m.group(1)}'"}]
    m = re.search(r"\b(hallway|open area)\s+([a-z])\b", text)
    if m:
        hits = [r for r in rooms if r["label"].lower() == f"{m.group(1)} {m.group(2)}"]
        if hits:
            return [{"room_id": hits[0]["id"], "label": hits[0]["label"], "confidence": 0.95, "why": "label match"}]

    near = re.split(rf"\b{NEAR_WORDS}\b", text, maxsplit=1)
    target_txt, landmark_txt = (near[0], near[1]) if len(near) == 2 else (text, "")
    target_types = _types_in(target_txt)
    landmark_types = _types_in(landmark_txt)
    side = side_from_text(text, front)
    want_corner = bool(re.search(r"\bcorner\b", text))
    want_big = bool(re.search(r"\b(?:big|large|main|open)\b", text))
    adj = neighbors(fp) if landmark_types else {}
    max_area = max(r.get("area_m2", 0) for r in rooms) or 1
    xs = [p[0] for p in fp.get("outline") or []]
    ys = [p[1] for p in fp.get("outline") or []]

    def is_corner(r) -> bool:
        if not xs:
            return False
        rx, ry = [p[0] for p in r["polygon"]], [p[1] for p in r["polygon"]]
        on_x = min(rx) - min(xs) < 0.6 or max(xs) - max(rx) < 0.6
        on_y = min(ry) - min(ys) < 0.6 or max(ys) - max(ry) < 0.6
        return on_x and on_y

    scored = []
    for r in rooms:
        score, why = 0.0, []
        if target_types and r["type"] in target_types:
            score += 1.0
            why.append(f"is {r['type'].replace('_', ' ')}")
        if landmark_types:
            hits = [n for n in adj[r["id"]] if by_id[n]["type"] in landmark_types]
            if hits:
                # many-door hubs (main corridors) make weaker landmarks
                score += 0.8 / max(1.0, len(adj[hits[0]]) / 4)
                why.append(f"next to {by_id[hits[0]]['label']}")
        if want_corner and is_corner(r):
            score += 0.5
            why.append("corner room")
        if want_big:
            score += 0.5 * r.get("area_m2", 0) / max_area
        if side and (r.get("side") == side or side in (r.get("exterior_sides") or [])):
            score += 0.4
            why.append(f"side {side}")
        if score > 0.05:
            scored.append((score, r, why))
    if not scored:
        return []
    scored.sort(key=lambda x: (-x[0], x[1]["label"]))
    best = scored[0][0]
    ties = sum(1 for s, _, _ in scored if s >= best - 0.05)
    out = []
    for s, r, why in scored[:top]:
        conf = min(0.9, 0.35 + 0.25 * s) / (ties if s >= best - 0.05 else ties + 1)
        out.append({"room_id": r["id"], "label": r["label"], "confidence": round(conf, 2), "why": ", ".join(why) or "size"})
    return out
