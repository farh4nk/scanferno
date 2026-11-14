"""Commander Q&A during the incident: "nearest exit from Office 104?", "what's on the roof?".

With GEMINI_API_KEY set, Gemini answers by calling the tools below (automatic function calling), so every
answer is grounded in the floor plan, Vexcel and CoStar data. Without a key, simple intent rules call the
same tools. Either way the response carries `highlight` (rooms, doors, route polylines) for the UI.
"""
import json
import os
import re

from data import layers
from dispatch.locate import locate
from geometry import wallfollow


class Tools:
    def __init__(self, bid: str, dispatch: dict | None = None):
        self.bid = bid
        self.dispatch = dispatch or {}
        self.fp = layers.floorplan(bid)
        self.nav = layers.nav(bid)
        self.rooms = {r["id"]: r for r in self.fp["rooms"]}
        self.highlight = {"rooms": [], "doors": [], "polylines": []}
        self.calls: list[dict] = []

    def _room(self, text: str) -> dict | None:
        if text in self.rooms:
            return self.rooms[text]
        c = locate(text, self.fp, self.nav, layers.building(self.bid).get("front", "S"), top=1)
        return self.rooms[c[0]["room_id"]] if c else None

    def _log(self, name, args, result):
        self.calls.append({"tool": name, "args": args})
        return result

    def find_room(self, description: str) -> list:
        """Find rooms on the floor plan matching a description like 'office by the kitchen' or 'Office 104'."""
        out = locate(description, self.fp, self.nav, layers.building(self.bid).get("front", "S"))
        self.highlight["rooms"] += [c["room_id"] for c in out[:1]]
        return self._log("find_room", {"description": description}, out)

    def nearest_exit(self, room: str) -> dict:
        """Shortest walking route from a room (label or description) to the nearest exit door."""
        r = self._room(room)
        if not r:
            return {"error": f"no room matches '{room}'"}
        route = self.nav.to_exit(r["id"]) or {}
        route.pop("nodes", None)
        ex = self.nav.doors.get(route.get("exit_door_id"), {})
        route.update({"from": r["label"], "via": [self.rooms[x]["label"] for x in route.get("path", [])],
                      "exit_side": ex.get("side"), "exit_inferred": bool(ex.get("inferred"))})
        self.highlight["rooms"].append(r["id"])
        self.highlight["doors"].append(route.get("exit_door_id"))
        self.highlight["polylines"].append(route.get("polyline"))
        return self._log("nearest_exit", {"room": room}, route)

    def route_between(self, from_room: str, to_room: str) -> dict:
        """Shortest walking route between two rooms."""
        a, b = self._room(from_room), self._room(to_room)
        if not a or not b:
            return {"error": "room not found"}
        route = self.nav.between(a["id"], b["id"]) or {}
        route["via"] = [self.rooms[x]["label"] for x in route.get("path", [])]
        self.highlight["rooms"] += [a["id"], b["id"]]
        self.highlight["polylines"].append(route.get("polyline"))
        return self._log("route_between", {"from_room": from_room, "to_room": to_room}, route)

    def mayday_directions(self, room: str) -> dict:
        """Wall-following directions out (zero visibility) for a crew last seen in a room."""
        r = self._room(room)
        if not r:
            return {"error": f"no room matches '{room}'"}
        res = wallfollow.mayday(self.fp, r["id"], self.nav, layers.sides(self.bid).of_local)
        self.highlight["rooms"].append(r["id"])
        self.highlight["doors"].append(res.get("exit_door_id"))
        self.highlight["polylines"].append(res.get("wall_path"))
        return self._log("mayday_directions", {"room": room}, {k: v for k, v in res.items() if k != "wall_path"})

    def room_details(self, room: str) -> dict:
        """Type, size, doors, windows, side and disorientation (maze) score of a room."""
        r = self._room(room)
        if not r:
            return {"error": f"no room matches '{room}'"}
        doors = self.nav.doors_of(r["id"])
        windows = [w for w in self.fp.get("windows") or [] if w["room_id"] == r["id"]]
        self.highlight["rooms"].append(r["id"])
        return self._log("room_details", {"room": room}, {
            "label": r["label"], "type": r["type"], "area_m2": r.get("area_m2"), "side": r.get("side"),
            "doors": [{"to": next((self.rooms[x]["label"] if x in self.rooms else x) for x in d["rooms"] if x != r["id"]),
                       "width_m": d["width_m"], "exit": d["is_exit"]} for d in doors],
            "exterior_windows": sum(1 for w in windows if w.get("exterior")),
            "maze_score": self.fp["maze_score"].get(r["id"]),
            "maze_why": self.fp["maze_detail"].get(r["id"], {}).get("why"),
        })

    def roof_and_exterior(self) -> dict:
        """Roof material, height, skylights, HVAC units, solar, defects, footprint and side ladder staging points (Vexcel)."""
        o = layers.outside(self.bid)
        return self._log("roof_and_exterior", {}, {k: o[k] for k in ("roof_height_m", "footprint_area_m2", "roof", "sides")})

    def tenants(self, floor: int = 0) -> dict:
        """Who is inside (CoStar): tenants, industries, employees. floor=0 means all floors."""
        c = layers.costar(self.bid)
        names = {1: "FirstFloor", 2: "SecondFloor", 3: "ThirdFloor", 4: "FourthFloor", 5: "FifthFloor"}
        ts = [t for t in c.get("tenants") or [] if not floor or t.get("floor") == names.get(floor)]
        return self._log("tenants", {"floor": floor}, {
            "building": c.get("building_name"), "stories": c.get("stories"), "year_built": c.get("year_built"),
            "construction": c.get("construction_material"), "sprinklers": c.get("has_sprinklers"),
            "tenants": [{k: t.get(k) for k in ("name", "industry", "floor", "suite", "employees")} for t in ts][:25],
            "employees": sum(t.get("employees") or 0 for t in ts)})

    def all(self) -> list:
        return [self.find_room, self.nearest_exit, self.route_between, self.mayday_directions,
                self.room_details, self.roof_and_exterior, self.tenants]


SYSTEM = """You are Scanferno, an assistant to a fire incident commander. Answer in 1-3 short, radio-style sentences.
Always call a tool to ground the answer in the building data; never guess rooms, distances or hazards.
Use room labels exactly as the tools return them, fireground sides (A/Alpha front, B, C rear, D), and meters.
If data is inferred or uncertain, say so briefly. Current incident facts: {facts}"""


def _rules(t: Tools, q: str) -> str:
    low = q.lower()
    m = re.search(r"from (.+?) to (.+?)[?.!]*$", low)
    if m and not re.search(r"\bexit\b", low):
        r = t.route_between(m.group(1), m.group(2))
        return f"{' -> '.join(r.get('via', []))}, about {r.get('distance_m', '?')} m." if "via" in r else "Couldn't find those rooms."
    room_txt = re.sub(r"^.*?\b(?:from|in|for|of|at|near|by)\b\s+", "", low).strip(" ?.!") if re.search(r"\b(?:from|in|for|of|at)\b", low) else low
    if re.search(r"\bmayday|lost|disoriented\b", low):
        r = t.mayday_directions(room_txt)
        return " ".join(r.get("directions", [r.get("error", "")]))
    if re.search(r"\bexit|way out|get out|egress\b", low):
        r = t.nearest_exit(room_txt)
        if "error" in r:
            return r["error"]
        tail = " (inferred exit, verify)" if r.get("exit_inferred") else ""
        return f"From {r['from']}: {' -> '.join(r['via'])}, exit on side {r.get('exit_side')}, {r['distance_m']} m{tail}."
    if re.search(r"\broof|ladder|skylight|solar|hvac|aerial|height\b", low):
        o = t.roof_and_exterior()
        roof = o["roof"]
        bits = [f"Roof about {o['roof_height_m']} m, {roof['material']} {roof['shape'] or ''}".strip(),
                f"{roof['skylights']} skylights", f"{roof['ac_units']} HVAC units", "solar panels" if roof["solar"] else "no solar"]
        if (roof.get("defects", {}).get("water-pooling") or 0) > 20:
            bits.append(f"ponding on {roof['defects']['water-pooling']:.0f}% of the roof")
        return ", ".join(bits) + "."
    if re.search(r"\btenant|who|occupan|people|employees|business\b", low):
        fl = re.search(r"\b(\d)(?:st|nd|rd|th)? floor|floor (\d)\b", low)
        r = t.tenants(int(next(g for g in fl.groups() if g)) if fl else 0)
        top = ", ".join(f"{x['name']} ({x['industry']})" for x in r["tenants"][:4])
        return f"About {r['employees']} employees. Tenants include {top}."
    r = t.room_details(room_txt)
    if "error" in r:
        return "Ask about exits, routes, a mayday, the roof, tenants, or a specific room."
    why = "; ".join(r.get("maze_why") or []) or "easy to get out of"
    return f"{r['label']}: {r['type']}, {r['area_m2']} m², {len(r['doors'])} door(s), side {r['side']}, maze score {r['maze_score']} ({why})."


def ask(bid: str, question: str, dispatch: dict | None = None, use_llm: bool | None = None) -> dict:
    t = Tools(bid, dispatch)
    source = "rules"
    answer = None
    if use_llm if use_llm is not None else bool(os.getenv("GEMINI_API_KEY")):
        try:
            from google.genai import types

            from agent import llm
            facts = json.dumps({k: (dispatch or {}).get(k) for k in ("floor", "side", "conditions", "hazards", "trapped", "fire_room_ids")}, default=str)
            resp = llm.client().models.generate_content(
                model=llm.model(), contents=question,
                config=types.GenerateContentConfig(system_instruction=SYSTEM.format(facts=facts), tools=t.all()))
            answer, source = resp.text.strip(), "gemini"
        except Exception as e:
            source = f"rules (gemini failed: {type(e).__name__})"
    if answer is None:
        answer = _rules(t, question)
    hl = {k: [x for x in v if x] for k, v in t.highlight.items()}
    return {"question": question, "answer": answer, "source": source, "tool_calls": t.calls, "highlight": hl}
