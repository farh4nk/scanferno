"""Path simulation: one continuous run for a search crew.

In through an entry door, to a point well inside each room of the search plan in order, then out the
nearest exit. Nothing extra is walked inside a room: the run only has to get inside each one.
The result is a single polyline with a stop at each room, plus a `clip` in the same shape as a guided
tour clip (agent/tour.py), so the 3D viewer can play the whole run with the player it already has.
"""
import networkx as nx
from shapely.geometry import Point
from shapely.ops import polylabel

from agent.tour import Tour
from geometry.navgraph import NavGraph, RoomSpace, polyline_length

MAX_ROOMS = 12
CLEARANCE_M = 0.6  # the point inside a room is at least this far from its walls


def inside_point(space: RoomSpace, centroid) -> tuple:
    """A point clearly inside the room: its centre if that is well clear of the walls, else the roomiest spot in it."""
    p = Point(centroid)
    if space.poly.contains(p) and space.poly.boundary.distance(p) >= CLEARANCE_M:
        return tuple(centroid)
    best = polylabel(space.poly, tolerance=0.1)
    return (best.x, best.y)


def _join(parts: list[list]) -> list:
    out: list = []
    for p in parts:
        for pt in p:
            if not out or abs(out[-1][0] - pt[0]) > 1e-6 or abs(out[-1][1] - pt[1]) > 1e-6:
                out.append(list(pt))
    return out


def _walk(nav: NavGraph, nodes: list, anchors: dict) -> list:
    """Polyline along a node path (rooms and doors), with each room's node at its inside point."""
    pos = lambda n: anchors[n[1]] if n[0] == "room" else tuple(nav.g.nodes[n]["pos"])  # noqa: E731
    pts: list = []
    for u, v in zip(nodes, nodes[1:]):
        leg = nav._leg(nav.g[u][v]["room"], pos(u), pos(v))
        pts.extend(leg if not pts else leg[1:])
    return [[round(x, 2), round(y, 2)] for x, y in pts]


def _nodes_between(nav: NavGraph, a: str, b: str) -> list | None:
    try:
        return nx.shortest_path(nav.inside, ("room", a), ("room", b), weight="weight")
    except (nx.NetworkXNoPath, nx.NodeNotFound):
        return None


def build(fp: dict, nav: NavGraph, side_of, rooms: list[str], entry: str | None = None, exit_: str | None = None,
          avoid=(), reasons: dict | None = None, with_out: bool = True) -> dict | None:
    """`rooms`: room ids in the order to check. Rooms that cannot be reached from the entry are skipped."""
    t = Tour(fp, nav, side_of)
    order: list[str] = []
    for rid in rooms:
        if rid in t.rooms and rid not in order:
            order.append(rid)
    order = order[:MAX_ROOMS]
    if not order:
        return None
    into = t.pick_exit(order[0], entry, ())
    if not into:
        return None
    reachable = nav.exit_distances(order[0])
    order = [r for r in order if r == order[0] or nav.between(order[0], r)]
    out = t.pick_exit(order[-1], exit_, avoid) if with_out else None
    if with_out and not out:
        return None

    anchors = {rid: inside_point(nav.spaces[rid], nav.g.nodes[("room", rid)]["pos"]) for rid in order}
    legs: list[dict] = []
    in_nodes = list(reversed([n for n in into["nodes"] if n != "outside"]))
    legs.append({"kind": "in", "from": into["exit_door_id"], "to": order[0], "polyline": _walk(nav, in_nodes, anchors)})
    for a, b in zip(order, order[1:]):
        legs.append({"kind": "search", "from": a, "to": b, "polyline": _walk(nav, _nodes_between(nav, a, b), anchors)})
    if out:
        out_nodes = [n for n in out["nodes"] if n != "outside"]
        legs.append({"kind": "out", "from": order[-1], "to": out["exit_door_id"], "polyline": _walk(nav, out_nodes, anchors)})

    # distance along the whole run at the end of each leg; the stop for room i is where leg i ends
    s = 0.0
    for leg in legs:
        leg["start_m"] = round(s, 1)
        leg["distance_m"] = round(polyline_length(leg["polyline"]), 1)
        s += polyline_length(leg["polyline"])
        leg["end_m"] = round(s, 1)
    poly = _join([leg["polyline"] for leg in legs])
    total = round(polyline_length(poly), 1)

    reasons = reasons or {}
    n = len(order)
    stops = []
    for i, rid in enumerate(order):
        stops.append({"room_id": rid, "label": t.label(rid), "order": i + 1, "at_m": legs[i]["end_m"], "xy": list(anchors[rid]),
                      "reason": reasons.get(rid), "fire": rid in set(avoid)})
    entry_info, exit_info = t.door_info(into["exit_door_id"]), (t.door_info(out["exit_door_id"]) if out else None)
    steps = [{"at_m": 0.0, "xy": poly[0], "room_id": order[0], "door_id": into["exit_door_id"], "turn_deg": None,
              "text": f"Enter at the side {entry_info['side']} door. {n} room{'s' if n != 1 else ''} to check, in order."}]
    for st in stops:
        why = f" {st['reason']}" if st["reason"] else ""
        steps.append({"at_m": st["at_m"], "xy": st["xy"], "room_id": st["room_id"], "door_id": None, "turn_deg": None,
                      "text": f"Room {st['order']} of {n}: {st['label']}.{why}".rstrip()})
    if exit_info:
        steps.append({"at_m": total, "xy": poly[-1], "room_id": None, "door_id": exit_info["door_id"], "turn_deg": None,
                      "text": f"All {n} room{'s' if n != 1 else ''} checked. Out the side {exit_info['side']} door, {legs[-1]['distance_m']:.0f} m from {t.label(order[-1])}."})
    steps.sort(key=lambda x: x["at_m"])
    return {
        "entry": entry_info,
        "exit": exit_info,
        "rooms": order,
        "stops": stops,
        "legs": legs,
        "polyline": poly,
        "total_m": total,
        "in_m": legs[0]["distance_m"],
        "search_m": round(sum(leg["distance_m"] for leg in legs if leg["kind"] == "search"), 1),
        "out_m": legs[-1]["distance_m"] if out else 0.0,
        "entries": sorted((dict(t.door_info(i), distance_m=m) for i, m in reachable.items()), key=lambda e: e["distance_m"]),
        "avoided": list(avoid),
        # same shape as a tour clip, so viewer3d's tourPlayer can fly the whole run
        "clip": {"kind": "search", "title": "Path simulation", "distance_m": total, "polyline": poly, "rooms": order,
                 "steps": steps, "door_id": into["exit_door_id"],
                 "stops": [{"xy": s_["xy"], "label": str(s_["order"]), "name": s_["label"]} for s_ in stops],
                 # each walking leg and the room it ends inside (null for the way out), so the 3D camera can make sure it goes in
                 "segments": [{"kind": leg["kind"], "room_id": leg["to"] if leg["kind"] != "out" else None, "polyline": leg["polyline"],
                               "start_m": leg["start_m"], "end_m": leg["end_m"]} for leg in legs]},
    }
