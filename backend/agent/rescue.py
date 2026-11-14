"""Rescue plan per reported person: where they likely are, the best way in, and the best way out with them.

People come from the dispatch record (trapped[], plus the caller if they say they are inside). Each is placed
at a point in their room from the caller's words ("by the window", "in the corner", "near the door to the
hall"), with an uncertainty radius that grows when the room match was a guess.

Routes are risk-weighted: walking time (slower crawling in smoke, slower again dragging a victim) times
(1 + RISK x danger) from the fire heat field, and rooms in the untenable zone cost a large penalty unless the
person is in one. Ways in and out are the exterior doors and every breakable exterior window wide enough to
pass a victim: a window costs breach time, plus a ground ladder above the first floor. So the plan can be
"in the side A door, back out the same way" or "in the door, pull them out the window in their room".

    plan(bid, dispatch, heat)  ->  {"people": [...], "summary": [...]}
"""
import math
import re

import networkx as nx
from shapely.geometry import Point, Polygon

from data import layers
from dispatch.locate import _types_in, locate
from geometry import heat as heat_model
from geometry.navgraph import NavGraph, polyline_length

STORY_M = 3.6
RISK = 3.0
UNTENABLE_PENALTY_S = 600.0
# m/s: (clear, in smoke). In = searching on the way to the victim, out = dragging or carrying them.
SPEED = {"in": (1.2, 0.5), "out": (0.8, 0.3)}
SMOKE_AT = 0.2
MIN_WINDOW_M = 0.6
# seconds: clear the glass and sash, then enter / lift the victim out
WINDOW_S = {"in": 30.0, "out": 45.0}
LADDER_S = {"in": 90.0, "out": 150.0}
PER_EXTRA_FLOOR_S = 30.0
OUTSIDE_WORDS = re.compile(r"\b(?:outside|across|out front|out back|parking|street|sidewalk|lot|car|driveway|neighbor)\b")
SPEAKER_INSIDE = re.compile(r"\b(?:in the|in my|in our|in a|in an|inside|stuck|trapped|locked in|hiding)\b")


def ladder_for(height_m: float | None) -> str:
    if height_m is None:
        return "ladder size unknown (no roof height)"
    if height_m <= 6:
        return "24 ft ground ladder reaches the roof"
    if height_m <= 10:
        return "35 ft ground ladder reaches the roof"
    return f"aerial device needed (roof about {height_m:.0f} m / {height_m * 3.28:.0f} ft)"


def window_ladder(sill_m: float) -> str:
    if sill_m < 1.5:
        return "no ladder"
    if sill_m <= 4.5:
        return "16-24 ft ground ladder"
    if sill_m <= 9:
        return "35 ft ground ladder"
    return "aerial ladder"


def fire_seeds(d: dict) -> dict[str, float]:
    """Fire rooms with strength: the best fire candidate 1.0, alternates by relative confidence."""
    ids = d.get("fire_room_ids") or []
    conf = {c["room_id"]: c.get("confidence", 0.5) for c in d.get("fire_candidates") or []}
    best = max((conf.get(r, 0.5) for r in ids), default=1.0) or 1.0
    return {r: round(max(0.4, conf.get(r, best) / best), 2) for r in ids}


def build_heat(bid: str, d: dict, minutes: float = 0.0) -> dict | None:
    return heat_model.field(layers.floorplan(bid), layers.nav(bid), fire_seeds(d), d.get("conditions"), minutes)


# ---------- people ----------

def people(d: dict) -> list[dict]:
    """Everyone to rescue: trapped[] plus the caller when they say they are inside (and aren't listed already)."""
    out = [dict(p) for p in d.get("trapped") or []]
    where = (d.get("caller_location") or "").lower()
    if where and not OUTSIDE_WORDS.search(where) and SPEAKER_INSIDE.search(where) and not any(p.get("is_caller") for p in out):
        out.append({"description": "caller (on the line)", "near": d["caller_location"], "is_caller": True,
                    "confidence": d.get("confidence", {}).get("caller_location", 0.7), "count": 1, "floor": d.get("floor")})
    return out


def _inward(pt, toward, m: float = 0.8):
    dx, dy = toward[0] - pt[0], toward[1] - pt[1]
    n = math.hypot(dx, dy) or 1.0
    k = min(m, n * 0.6) / n
    return (pt[0] + dx * k, pt[1] + dy * k)


def place(room: dict, phrase: str, fp: dict, nav: NavGraph) -> tuple[tuple, str]:
    """A point in the room for the person, from the words, and why."""
    text = (phrase or "").lower()
    c = tuple(room["centroid"])
    poly = Polygon(room["polygon"])
    windows = [w for w in fp.get("windows") or [] if w["room_id"] == room["id"]]
    doors = nav.doors_of(room["id"])
    pt, why = c, "room center"
    if re.search(r"\bwindows?\b", text) and windows:
        w = min(windows, key=lambda w: (not w.get("exterior"), -w["width_m"]))
        pt, why = _inward(w["position"], c), "by the window"
    elif re.search(r"\b(?:door|doorway|exit|entrance)\b", text) and doors:
        d = min(doors, key=lambda d: not d["is_exit"])
        pt, why = _inward(d["position"], c), "by the door"
    elif re.search(r"\bcorner\b", text):
        far = max(room["polygon"], key=lambda v: min((math.dist(v, d["position"]) for d in doors), default=0))
        pt, why = _inward(far, c, 1.0), "far corner (away from the doors)"
    else:
        near = re.split(r"\b(?:by|near|next to|beside|outside|across from|close to)\b", text, maxsplit=1)
        types = _types_in(near[1]) if len(near) == 2 else []
        hits = [d for d in doors if types and any(x in nav.rooms and x != room["id"] and nav.rooms[x]["type"] in types
                                                  for x in d["rooms"])]
        if hits:
            other = next(x for x in hits[0]["rooms"] if x != room["id"])
            pt, why = _inward(hits[0]["position"], c, 1.2), f"near the door to {nav.rooms[other]['label']}"
    if not poly.buffer(-0.1).contains(Point(pt)):
        pt, why = c, why + " (snapped to room center)"
    return (round(pt[0], 2), round(pt[1], 2)), why


# ---------- routes ----------

def _speed(direction: str, danger: float) -> float:
    clear, smoke = SPEED[direction]
    return smoke if danger >= SMOKE_AT else clear


def _graph(nav: NavGraph, vid: str, point, windows: list[dict]) -> nx.Graph:
    """Inside nav graph + a node for the person + a node per usable window (joined to its room's doors)."""
    g = nx.Graph(nav.inside)
    g.add_node("person", pos=point)
    for d in nav.doors_of(vid):
        pts = nav.spaces[vid].path(point, d["position"])
        g.add_edge("person", ("door", d["id"]), weight=polyline_length(pts), room=vid)
    for w in windows:
        node, rid, wp = ("window", w["id"]), w["room_id"], tuple(w["position"])
        g.add_node(node, pos=wp)
        if rid == vid:
            g.add_edge("person", node, weight=polyline_length(nav.spaces[rid].path(point, wp)), room=rid)
        for d in nav.doors_of(rid):
            g.add_edge(("door", d["id"]), node, weight=polyline_length(nav.spaces[rid].path(d["position"], wp)), room=rid)
    return g


def _cost(direction: str, danger: dict, vid: str):
    def w(u, v, d):
        z = danger.get(d.get("room"), 0.0)
        t = d["weight"] / _speed(direction, z) * (1 + RISK * z)
        if z >= heat_model.ZONES[0][1] and d.get("room") != vid:
            t += UNTENABLE_PENALTY_S
        return t
    return w


def _expand(g: nx.Graph, nav: NavGraph, nodes: list, direction: str, danger: dict) -> dict:
    pts, rooms, dist, secs, exposure, peak = [], [], 0.0, 0.0, 0.0, 0.0
    for u, v in zip(nodes, nodes[1:]):
        rid = g[u][v]["room"]
        leg = nav.spaces[rid].path(g.nodes[u]["pos"], g.nodes[v]["pos"])
        pts.extend(leg if not pts else leg[1:])
        m = polyline_length(leg)
        z = danger.get(rid, 0.0)
        dist += m
        secs += m / _speed(direction, z)
        exposure += m * z
        peak = max(peak, z)
        if not rooms or rooms[-1] != rid:
            rooms.append(rid)
    return {"path": rooms, "distance_m": round(dist, 1), "move_s": secs, "exposure": round(exposure, 1), "max_danger": round(peak, 2),
            "polyline": [[round(x, 2), round(y, 2)] for x, y in pts],
            "door_ids": [n[1] for n in nodes if isinstance(n, tuple) and n[0] == "door"]}


def _terminals(nav: NavGraph, windows: list[dict], direction: str, floor: int, danger: dict) -> dict:
    """Ways in / out: exterior doors (no extra time) and windows (breach, plus a ladder above floor 1)."""
    out = {("door", d["id"]): {"kind": "door", "id": d["id"], "side": d.get("side"), "extra_s": 0.0, "width_m": d["width_m"],
                               "inferred": bool(d.get("inferred"))}
           for d in nav.exits()}
    for w in windows:
        sill = (floor - 1) * STORY_M + (w.get("sill_m") or 0)
        ladder = window_ladder(sill)
        extra = WINDOW_S[direction] if ladder == "no ladder" else LADDER_S[direction] + PER_EXTRA_FLOOR_S * max(0, floor - 2)
        out[("window", w["id"])] = {"kind": "window", "id": w["id"], "side": w.get("side"), "extra_s": extra, "width_m": w["width_m"],
                                    "sill_above_ground_m": round(sill, 1), "ladder": ladder, "room_id": w["room_id"],
                                    "flow_path_warning": danger.get(w["room_id"], 0.0) >= heat_model.ZONES[1][1]}
    return out


def _options(g, nav, vid, direction, danger, terms, top=3) -> list[dict]:
    dist, paths = nx.single_source_dijkstra(g, "person", weight=_cost(direction, danger, vid))
    opts = []
    for node, t in terms.items():
        if node not in dist:
            continue
        nodes = paths[node] if direction == "out" else list(reversed(paths[node]))
        route = _expand(g, nav, nodes, direction, danger)
        secs = route.pop("move_s") + t["extra_s"]
        opts.append({**t, **route, "time_s": round(secs), "score": round(dist[node] + t["extra_s"], 1),
                     "through_untenable": [r for r in route["path"] if r != vid and danger.get(r, 0) >= heat_model.ZONES[0][1]]})
    opts.sort(key=lambda o: o["score"])
    return opts[:top]


def _describe(o: dict, labels: dict, direction: str) -> str:
    rooms = " > ".join(labels[r] for r in o["path"])
    if o["kind"] == "door":
        head = f"{'Enter' if direction == 'in' else 'Out'} via the side {o['side'] or '?'} door"
    else:
        lad = "" if o["ladder"] == "no ladder" else f", {o['ladder']} (sill ~{o['sill_above_ground_m']:.0f} m)"
        verb = "Enter (VES) through" if direction == "in" else "Break out and remove through"
        head = f"{verb} the side {o['side'] or '?'} window in {labels[o['room_id']]}{lad}"
    tail = f": {o['distance_m']:.0f} m, ~{o['time_s']} s"
    if rooms:
        tail += f" ({rooms})"
    if o.get("through_untenable"):
        tail += f"; passes untenable {', '.join(labels[r] for r in o['through_untenable'])}"
    if o.get("flow_path_warning"):
        tail += "; venting here opens a flow path, coordinate with the attack line"
    return head + tail + "."


def plan(bid: str, d: dict, heat: dict | None = None) -> dict:
    fp, nav = layers.floorplan(bid), layers.nav(bid)
    labels = {r["id"]: r["label"] for r in fp["rooms"]}
    danger = {rid: x["danger"] for rid, x in ((heat or {}).get("rooms") or {}).items()}
    floor = d.get("floor") or 1
    windows = [w for w in fp.get("windows") or [] if w.get("exterior") and w["width_m"] >= MIN_WINDOW_M
               and danger.get(w["room_id"], 0.0) < heat_model.ZONES[0][1]]
    out = []
    for i, p in enumerate(people(d)):
        if p.get("is_caller") and not p.get("room_id"):
            cands = locate(p.get("near") or "", fp, nav, layers.building(bid).get("front", "S"))
            p["room_id"] = cands[0]["room_id"] if cands else None
            p["room_candidates"] = cands
        person = {"id": f"p{i + 1}", "description": p.get("description") or "person", "count": p.get("count") or 1,
                  "needs_assist": bool(p.get("needs_assist")), "is_caller": bool(p.get("is_caller")),
                  "said": p.get("near") or p.get("location"), "confidence": p.get("confidence"), "room_id": p.get("room_id")}
        rid = p.get("room_id")
        if rid not in nav.rooms:
            person.update({"located": False, "text": f"{person['description']}: location unknown, follow the search plan."})
            out.append(person)
            continue
        room = nav.rooms[rid]
        point, basis = place(room, p.get("near") or p.get("location") or "", fp, nav)
        cands = p.get("room_candidates") or []
        top_conf = cands[0]["confidence"] if cands else (p.get("confidence") or 0.5)
        radius = math.sqrt(room.get("area_m2", 10) / math.pi)
        g = _graph(nav, rid, point, windows)
        entry = _options(g, nav, rid, "in", danger, _terminals(nav, windows, "in", floor, danger))
        exits = _options(g, nav, rid, "out", danger, _terminals(nav, windows, "out", floor, danger))
        for o in entry:
            o["text"] = _describe(o, labels, "in")
        for o in exits:
            o["text"] = _describe(o, labels, "out")
            o["same_as_entry"] = bool(entry) and o["kind"] == entry[0]["kind"] and o["id"] == entry[0]["id"]
        here = heat_model.point_danger(heat, point) or danger.get(rid, 0.0)
        person.update({
            "located": True, "label": room["label"], "position": list(point), "position_basis": basis,
            "uncertainty_m": round(radius if basis.startswith("room center") else min(radius, 2.0), 1),
            "room_confidence": round(top_conf, 2),
            "alternates": [{"room_id": c["room_id"], "label": c["label"], "confidence": c["confidence"]} for c in cands[1:3]],
            "danger": round(here, 2), "zone": heat_model.zone(here),
            "entry": entry[0] if entry else None, "entry_options": entry,
            "extraction": exits[0] if exits else None, "extraction_options": exits,
        })
        if entry and exits:
            total = entry[0]["time_s"] + exits[0]["time_s"]
            back = "back out the same way" if exits[0]["same_as_entry"] else exits[0]["text"][0].lower() + exits[0]["text"][1:]
            person["total_time_s"] = total
            person["text"] = (f"{person['description'].capitalize()} in {room['label']} ({basis}, {heat_model.zone(here)}). "
                              f"{entry[0]['text']} Then {back}" + ("" if back.endswith(".") else ".")
                              + f" About {total} s door to door.")
        out.append(person)

    def urgency(p):
        if not p.get("located"):
            return (1, 0)
        return (0, -(p["danger"] + (0.3 if p["needs_assist"] else 0)) * (p.get("room_confidence") or 0.5) - 0.001 * (p.get("count") or 1))
    out.sort(key=urgency)
    for n, p in enumerate(out, 1):
        p["priority"] = n
    return {"people": out, "floor": floor, "windows_considered": len(windows),
            "assumptions": ["Speeds: walk 1.2 m/s clear, crawl-search 0.5 m/s in smoke; drag 0.8 / 0.3 m/s.",
                            "Window removal adds breach time, plus a ground ladder above the first floor.",
                            "Danger is a model of spread from the reported fire area, not a sensor reading."]}
