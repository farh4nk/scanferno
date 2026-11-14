"""Egress analysis and the maze score (disorientation index).

For every room: shortest route to the nearest exit, distance to a *second* exit, turns along the route,
decision points (passing through rooms with 3+ doors), dead ends, and whether the room has an outside
window. These combine into a 0..1 maze score. Every component is returned so the UI and the agent can
say *why* a room is red, not just that it is.
"""
import math

from .navgraph import NavGraph

WEIGHTS = {"distance": 0.35, "turns": 0.2, "decisions": 0.15, "dead_end": 0.15, "single_exit": 0.1, "windowless": 0.05}
TURN_DEG = 35
SEPARATE_EXIT_M = 5.0


def count_turns(polyline: list) -> int:
    turns = 0
    for a, b, c in zip(polyline, polyline[1:], polyline[2:]):
        v1, v2 = (b[0] - a[0], b[1] - a[1]), (c[0] - b[0], c[1] - b[1])
        n1, n2 = math.hypot(*v1), math.hypot(*v2)
        if n1 < 0.3 or n2 < 0.3:
            continue
        cos = max(-1.0, min(1.0, (v1[0] * v2[0] + v1[1] * v2[1]) / (n1 * n2)))
        if math.degrees(math.acos(cos)) > TURN_DEG:
            turns += 1
    return turns


def analyze(fp: dict, nav: NavGraph | None = None) -> dict:
    """Returns {"maze_score": {room: 0..1}, "maze_detail": {room: {...}}, "exit_routes": {room: route}}."""
    nav = nav or NavGraph(fp)
    exterior_windows = {w["room_id"] for w in fp.get("windows") or [] if w.get("exterior")}
    raw, routes = {}, {}
    for rid in nav.rooms:
        route = nav.to_exit(rid)
        if route is None:
            raw[rid] = None
            continue
        route.pop("nodes", None)
        routes[rid] = route
        first = nav.doors[route["exit_door_id"]]["position"]
        second = [dist for did, dist in nav.exit_distances(rid).items()
                  if math.dist(nav.doors[did]["position"], first) > SEPARATE_EXIT_M]
        branchy = [r for r in route["path"][1:] if len(nav.doors_of(r)) >= 3]
        n_doors = len(nav.doors_of(rid))
        raw[rid] = {
            "distance_m": route["distance_m"],
            "second_exit_m": min(second) if second else None,
            "turns": count_turns(route["polyline"]),
            "decisions": len(branchy),
            "dead_end": n_doors == 1 and not any(d["is_exit"] for d in nav.doors_of(rid)),
            "windowless": rid not in exterior_windows,
        }

    reachable = [v for v in raw.values() if v]
    max_d = max((v["distance_m"] for v in reachable), default=1) or 1
    max_t = max((v["turns"] for v in reachable), default=1) or 1
    max_k = max((v["decisions"] for v in reachable), default=1) or 1

    scores, detail = {}, {}
    for rid, v in raw.items():
        if v is None:
            scores[rid] = 1.0
            detail[rid] = {"unreachable": True, "why": ["No route to any known exit."]}
            continue
        single = v["second_exit_m"] is None or v["second_exit_m"] > 2.5 * max(v["distance_m"], 1)
        parts = {
            "distance": v["distance_m"] / max_d,
            "turns": v["turns"] / max_t,
            "decisions": v["decisions"] / max_k,
            "dead_end": 1.0 if v["dead_end"] else 0.0,
            "single_exit": 1.0 if single else 0.0,
            "windowless": 1.0 if v["windowless"] else 0.0,
        }
        score = sum(WEIGHTS[k] * parts[k] for k in WEIGHTS)
        why = []
        if parts["distance"] > 0.6:
            why.append(f"{v['distance_m']:.0f} m to the nearest exit")
        if v["turns"] >= 3:
            why.append(f"{v['turns']} turns on the way out")
        if v["decisions"] >= 2:
            why.append(f"{v['decisions']} branching rooms to pick through")
        if v["dead_end"]:
            why.append("one door only (dead end)")
        if single:
            why.append("no practical second way out")
        if v["windowless"]:
            why.append("no outside window")
        scores[rid] = round(min(1.0, score), 2)
        detail[rid] = {**v, "single_exit": single, "components": {k: round(x, 2) for k, x in parts.items()}, "why": why}
    return {"maze_score": scores, "maze_detail": detail, "exit_routes": routes}
