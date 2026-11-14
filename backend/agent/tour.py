"""Guided tour clips: the way in from a chosen entry door to a target room, and the way back out.

The 3D viewer plays each leg as a clip (camera hops along the polyline, caption per step), so a crew
can watch the route instead of clicking through the model. This module only produces data: a polyline in
floor plan meters per leg plus step captions anchored by distance along that polyline.
"""
import math

from geometry.navgraph import NavGraph, polyline_length

CORNER_MIN_DEG = 45  # polyline bends sharper than this get their own "turn" step
STRAIGHT_DEG = 30  # door crossings that change heading less than this read as "straight on"
LOOK_M = 1.2  # how far either side of a door to measure the turn


def _door_nodes(nodes: list) -> list[str]:
    return [n[1] for n in nodes if isinstance(n, tuple) and n[0] == "door"]


def _cumulative(pts: list) -> list[float]:
    out = [0.0]
    for a, b in zip(pts, pts[1:]):
        out.append(out[-1] + math.dist(a, b))
    return out


def _along(pts: list, cum: list[float], s: float) -> tuple[float, float]:
    s = max(0.0, min(cum[-1], s))
    for i in range(1, len(pts)):
        if s <= cum[i] and cum[i] > cum[i - 1]:
            t = (s - cum[i - 1]) / (cum[i] - cum[i - 1])
            return (pts[i - 1][0] + (pts[i][0] - pts[i - 1][0]) * t, pts[i - 1][1] + (pts[i][1] - pts[i - 1][1]) * t)
    return tuple(pts[-1])


def _s_of(pts: list, cum: list[float], xy, after: float) -> float:
    """Distance along the polyline of the first vertex (at or past `after`) that coincides with xy, else nearest."""
    best, best_s = 1e9, after
    for i, p in enumerate(pts):
        if cum[i] + 0.05 < after:
            continue
        d = math.dist(p, xy)
        if d < 0.06:
            return cum[i]
        if d < best:
            best, best_s = d, cum[i]
    return best_s


def _turn(pts: list, cum: list[float], s: float) -> float | None:
    """Signed heading change (degrees, positive = left) when passing distance `s`; None if it can't be measured."""
    a, b, c = _along(pts, cum, s - LOOK_M), _along(pts, cum, s), _along(pts, cum, s + LOOK_M)
    v1, v2 = (b[0] - a[0], b[1] - a[1]), (c[0] - b[0], c[1] - b[1])
    if math.hypot(*v1) < 0.2 or math.hypot(*v2) < 0.2:
        return None
    return math.degrees(math.atan2(v1[0] * v2[1] - v1[1] * v2[0], v1[0] * v2[0] + v1[1] * v2[1]))


def _turn_word(deg: float | None) -> str:
    if deg is None or abs(deg) < STRAIGHT_DEG:
        return "straight on"
    side = "left" if deg > 0 else "right"
    if abs(deg) > 150:
        return "turn around"
    return f"bear {side}" if abs(deg) < 60 else f"turn {side}"


def _dist(m: float) -> str:
    return "a step" if m < 1.5 else f"{round(m)} m"


class Tour:
    def __init__(self, fp: dict, nav: NavGraph, side_of):
        self.fp, self.nav, self.side_of = fp, nav, side_of
        self.rooms = {r["id"]: r for r in fp["rooms"]}

    def label(self, rid: str) -> str:
        r = self.rooms.get(rid) or {}
        return r.get("label") or r.get("type") or rid

    def door_side(self, door: dict) -> str:
        return door.get("side") or self.side_of(door["position"])

    def door_info(self, door_id: str) -> dict:
        d = self.nav.doors[door_id]
        return {"door_id": door_id, "side": self.door_side(d), "position": d["position"], "width_m": d["width_m"],
                "inferred": bool(d.get("inferred"))}

    def pick_exit(self, room_id: str, want: str | None, avoid=()) -> dict | None:
        """Route from a room to the exit named by `want` (door id, side letter) or the nearest one."""
        exits = {d["id"]: d for d in self.nav.exits()}
        if want in exits:
            return self.nav.to_exit(room_id, want, avoid)
        if want and len(want) == 1 and want.upper() in "ABCD":
            on_side = [d["id"] for d in exits.values() if self.door_side(d) == want.upper()]
            routes = [r for r in (self.nav.to_exit(room_id, i, avoid) for i in on_side) if r]
            if routes:
                return min(routes, key=lambda r: r["distance_m"])
        return self.nav.to_exit(room_id, None, avoid)

    def leg(self, kind: str, nodes: list, target: str) -> dict:
        """One clip. `nodes` runs in walking order; for kind "in" it starts at the entry door node."""
        r = self.nav.route(nodes)
        pts = [tuple(p) for p in r["polyline"]]
        cum = _cumulative(pts)
        doors = _door_nodes(nodes)
        entry_door, exit_door = doors[0] if kind == "in" else None, doors[-1] if kind == "out" else None
        rooms = r["path"]
        steps: list[dict] = []

        def add(s: float, text: str, room_id: str | None, turn: float | None = None, door_id: str | None = None):
            steps.append({"at_m": round(s, 1), "xy": [round(v, 2) for v in _along(pts, cum, s)], "text": text,
                          "room_id": room_id, "door_id": door_id, "turn_deg": None if turn is None else round(turn)})

        end = cum[-1]
        if kind == "in":
            d = self.nav.doors[entry_door]
            first = rooms[0] if rooms else target
            add(0.0, f"Enter at the side {self.door_side(d)} door into {self.label(first)}.", first, door_id=entry_door)
        else:
            add(0.0, f"Start in {self.label(target)}. Head for the side {self.door_side(self.nav.doors[exit_door])} exit.", target)

        # each interior door crossing, then sharp corners between doors
        last_s = 0.0
        crossings = doors[1:] if kind == "in" else doors[:-1]
        door_s: list[float] = []
        for i, did in enumerate(crossings):
            d = self.nav.doors[did]
            s = _s_of(pts, cum, d["position"], last_s)
            nxt = rooms[i + 1] if i + 1 < len(rooms) else None
            turn = _turn(pts, cum, s)
            word = _turn_word(turn)
            lead = f"{_dist(s - last_s)}, " if s - last_s >= 1.5 else ""
            via = "opening" if d.get("type") == "opening" else "door"
            tail = "" if word == "straight on" else ", then " + word
            text = f"{lead}through the {via} into {self.label(nxt)}{tail}."
            add(s, text[0].upper() + text[1:], nxt, turn, did)
            door_s.append(s)
            last_s = s
        for i in range(1, len(pts) - 1):
            if any(abs(cum[i] - ds) < 1.0 for ds in door_s) or cum[i] < 0.8 or end - cum[i] < 0.8:
                continue
            t = _turn(pts, cum, cum[i])
            if t is not None and abs(t) >= CORNER_MIN_DEG:
                add(cum[i], f"{_turn_word(t).capitalize()} at the corner.", None, t)
        steps.sort(key=lambda s: s["at_m"])
        if kind == "in":
            add(end, f"You are in {self.label(target)}.", target)
        else:
            d = self.nav.doors[exit_door]
            add(end, f"Out through the side {self.door_side(d)} door.", None, door_id=exit_door)
        return {
            "kind": kind,
            "title": "Way in" if kind == "in" else "Way out",
            "distance_m": round(polyline_length(pts), 1),
            "polyline": [list(p) for p in pts],
            "rooms": rooms,
            "steps": steps,
            "door_id": entry_door or exit_door,
        }

    def build(self, room_id: str, entry: str | None = None, exit_: str | None = None, avoid=()) -> dict | None:
        """Both legs for a target room. `entry` / `exit_`: a door id or side letter, default the nearest exit door."""
        into = self.pick_exit(room_id, entry, ())
        out = self.pick_exit(room_id, exit_, avoid)
        if not into or not out:
            return None
        in_leg = self.leg("in", list(reversed([n for n in into["nodes"] if n != "outside"])), room_id)
        out_leg = self.leg("out", [n for n in out["nodes"] if n != "outside"], room_id)
        dist = self.nav.exit_distances(room_id)
        return {
            "room_id": room_id,
            "room_label": self.label(room_id),
            "entry": self.door_info(into["exit_door_id"]),
            "exit": self.door_info(out["exit_door_id"]),
            "in": in_leg,
            "out": out_leg,
            "entries": sorted((dict(self.door_info(i), distance_m=m) for i, m in dist.items()), key=lambda e: e["distance_m"]),
            "avoided": list(avoid),
        }
