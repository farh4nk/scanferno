"""Mayday: a way out that keeps one hand on the wall, as spoken directions usable in zero visibility.

Each room's outline is a ring oriented counterclockwise. Walking the ring forward keeps the room interior
on your left, so the wall is on your right ("right hand on the wall"); walking it backward is left hand.
A route is a chain of legs (room, enter at door, leave at door). For each leg we walk the ring from the
entry point to the next door, collecting the corners we turn at and the doors we pass without entering.
For every reachable exit we choose a hand per room (switching only at a doorway, and only when it saves
more than SWITCH_PENALTY_M of wall) and keep the exit with the shortest wall route. The crew never has
to cross open floor.
"""
import math

from shapely.geometry import LineString, Point, Polygon
from shapely.geometry.polygon import orient

from .navgraph import OUTSIDE, NavGraph

CORNER_DEG = 40
MERGE_M = 1.2
SWITCH_PENALTY_M = 4.0
HANDS = ("left", "right")
INSET_M = 0.4


class Ring:
    def __init__(self, room: dict):
        poly = orient(Polygon(room["polygon"]), 1.0)
        self.line = LineString(poly.exterior.simplify(0.25).coords)
        self.L = self.line.length
        coords = list(self.line.coords)[:-1]
        self.corners = []
        s = 0.0
        n = len(coords)
        seg = [math.dist(coords[i], coords[(i + 1) % n]) for i in range(n)]
        for i in range(n):
            a, b, c = coords[i - 1], coords[i], coords[(i + 1) % n]
            v1, v2 = (b[0] - a[0], b[1] - a[1]), (c[0] - b[0], c[1] - b[1])
            n1, n2 = math.hypot(*v1), math.hypot(*v2)
            if n1 > 1e-6 and n2 > 1e-6:
                cross = v1[0] * v2[1] - v1[1] * v2[0]
                ang = math.degrees(math.atan2(cross, v1[0] * v2[0] + v1[1] * v2[1]))
                if abs(ang) > 10:
                    self.corners.append((s, ang))
            s += seg[i]

    def s(self, xy) -> float:
        return self.line.project(Point(xy))

    def point(self, s: float, inset: float = INSET_M) -> list[float]:
        s %= self.L
        p = self.line.interpolate(s)
        a, b = self.line.interpolate((s - 0.05) % self.L), self.line.interpolate((s + 0.05) % self.L)
        tx, ty = b.x - a.x, b.y - a.y
        n = math.hypot(tx, ty) or 1
        return [round(p.x - ty / n * inset, 2), round(p.y + tx / n * inset, 2)]


def _walk(ring: Ring, s_from: float, s_to: float, direction: int, doors: list[tuple[float, dict]], skip: set):
    dist = ((s_to - s_from) * direction) % ring.L
    events = []
    for s, ang in ring.corners:
        along = ((s - s_from) * direction) % ring.L
        if 0.3 < along < dist - 0.3:
            events.append((along, "corner", ang * direction))
    for s, d in doors:
        if d["id"] in skip:
            continue
        along = ((s - s_from) * direction) % ring.L
        if 0.3 < along < dist - 0.3:
            events.append((along, "pass", d))
    events.sort(key=lambda e: e[0])
    pts = [ring.point(s_from + direction * t) for t in _steps(dist)]
    return dist, _merge_corners(events), pts


def _merge_corners(events: list) -> list:
    """Collapse wall jogs: corners within MERGE_M of each other become one net turn, or none if they cancel."""
    out, group = [], []

    def flush():
        if group:
            net = sum(g[2] for g in group)
            if abs(net) >= CORNER_DEG:
                out.append((group[-1][0], "corner", "left" if net > 0 else "right"))
            group.clear()

    for e in events:
        if e[1] == "corner" and (not group or e[0] - group[-1][0] <= MERGE_M):
            group.append(e)
            continue
        flush()
        if e[1] == "corner":
            group.append(e)
        else:
            out.append(e)
    flush()
    return out


def _steps(dist: float, step: float = 0.5):
    n = max(1, int(dist / step))
    return [dist * i / n for i in range(n + 1)]


def _legs(nav: NavGraph, nodes: list) -> list[tuple[str, str | None, str]]:
    legs = []
    for u, v in zip(nodes, nodes[1:]):
        if v == OUTSIDE:
            break
        rid = nav.g[u][v]["room"]
        legs.append((rid, u[1] if u[0] == "door" else None, v[1]))
    return legs


def _fmt(d: float) -> str:
    return "about 1 meter" if d < 1.5 else f"{round(d)} meters"


def _leg_walk(nav: NavGraph, rings: dict, leg: tuple, start_xy, hand: str):
    rid, from_door, to_door = leg
    ring = rings[rid]
    doors = [(ring.s(d["position"]), d) for d in nav.doors_of(rid)]
    s_from = ring.s(start_xy) if from_door is None else ring.s(nav.doors[from_door]["position"])
    s_to = ring.s(nav.doors[to_door]["position"])
    return _walk(ring, s_from, s_to, 1 if hand == "right" else -1, doors, {from_door, to_door})


def _plan(nav: NavGraph, rings: dict, start_room: str, legs: list):
    """Pick a hand per leg (DP with a penalty for switching) and stitch the legs into one timeline."""
    start_xy = nav.rooms[start_room]["centroid"]
    walks = [{h: _leg_walk(nav, rings, leg, start_xy, h) for h in HANDS} for leg in legs]
    cost = {h: walks[0][h][0] for h in HANDS}
    back = [{h: None for h in HANDS}]
    for w in walks[1:]:
        nxt, ptr = {}, {}
        for h in HANDS:
            o = "left" if h == "right" else "right"
            stay, switch = cost[h], cost[o] + SWITCH_PENALTY_M
            nxt[h], ptr[h] = (stay, h) if stay <= switch else (switch, o)
            nxt[h] += w[h][0]
        cost = nxt
        back.append(ptr)
    hand = min(HANDS, key=lambda h: cost[h])
    hands = [hand]
    for ptr in reversed(back[1:]):
        hands.append(ptr[hands[-1]])
    hands.reverse()

    total, timeline, pts = 0.0, [], []
    for leg, w, h in zip(legs, walks, hands):
        dist, events, leg_pts = w[h]
        rid, _, to_door = leg
        for along, kind, data in events:
            timeline.append((total + along, kind, data, rid, h))
        total += dist
        timeline.append((total, "through", nav.doors[to_door], rid, h))
        pts.extend(leg_pts)
    to_wall = rings[start_room].line.distance(Point(start_xy))
    return {"to_wall": to_wall, "walk": total, "cost": cost[hand], "timeline": timeline, "pts": pts, "hands": hands}


def _directions(nav: NavGraph, plan: dict, side_of=None) -> list[str]:
    hands = plan["hands"]
    out = [f"Crawl to the nearest wall ({_fmt(plan['to_wall'])}).", f"{hands[0].capitalize()} hand on the wall."]
    last, passes, current = 0.0, 0, hands[0]
    for at, kind, data, rid, hand in plan["timeline"]:
        if hand != current:
            out.append(f"Switch to your {hand} hand.")
            current = hand
        if kind == "pass":
            passes += 1
            continue
        d = at - last
        lead = f"Follow the wall {_fmt(d)}" if d >= 0.8 else "Right away"
        passed = f", passing {passes} door{'s' if passes > 1 else ''} on your {hand}" if passes else ""
        if kind == "corner":
            out.append(f"{lead}{passed}, then turn {data} at the corner.")
        elif data["is_exit"]:
            where = f" on the {side_of(data['position'])} side" if side_of else ""
            out.append(f"{lead}{passed}. Exit door on your {hand}: you're outside{where}.")
        else:
            nxt = next((x for x in data["rooms"] if x != rid), None)
            label = nav.rooms[nxt]["label"] if nxt in nav.rooms else "the next space"
            out.append(f"{lead}{passed}, then go through the door on your {hand} into {label}.")
        last, passes = at, 0
    return out


def mayday(fp: dict, room_id: str, nav: NavGraph | None = None, side_of=None) -> dict:
    nav = nav or NavGraph(fp)
    if room_id not in nav.rooms:
        raise KeyError(f"Unknown room {room_id}")
    rings = {rid: Ring(r) for rid, r in nav.rooms.items()}
    shortest = nav.to_exit(room_id)
    best = None
    for ex in nav.exits():
        route = nav.to_exit(room_id, ex["id"])
        if route is None:
            continue
        plan = _plan(nav, rings, room_id, _legs(nav, route["nodes"] + [OUTSIDE]))
        if best is None or plan["cost"] < best[0]["cost"]:
            best = (plan, route, ex)
    if best is None:
        return {"from_room_id": room_id, "path": [], "door_ids": [], "exit_door_id": None, "exit_side": None,
                "hand": None, "distance_m": None, "shortest_m": None, "doors_passed": 0, "wall_path": [],
                "directions": ["No known exit reachable from this room. Call for RIT and get to a window if you can."]}
    plan, route, ex = best
    walk_m = plan["walk"] + plan["to_wall"]
    advisory = None
    if shortest and walk_m > 2 * max(shortest["distance_m"], 1):
        advisory = (f"Wall route is {walk_m:.0f} m against {shortest['distance_m']:.0f} m direct through open floor: "
                    "large open space, have RIT run a search line.")
    return {
        "from_room_id": room_id,
        "path": route["path"],
        "door_ids": route["door_ids"],
        "exit_door_id": ex["id"],
        "exit_side": side_of(ex["position"]) if side_of else None,
        "hand": plan["hands"][0],
        "distance_m": round(walk_m, 1),
        "shortest_m": shortest["distance_m"] if shortest else None,
        "advisory": advisory,
        "doors_passed": sum(1 for e in plan["timeline"] if e[1] == "pass"),
        "directions": _directions(nav, plan, side_of),
        "wall_path": plan["pts"],
    }

