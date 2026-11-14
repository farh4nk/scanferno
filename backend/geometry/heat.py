"""Fire danger field: how hot / smoky each part of the floor is likely to be, from where the fire started.

Heat and smoke travel mostly through openings, so the main term is walking distance from the fire area over
the nav graph (through doors), decaying over `spread_m`. A weaker term leaks straight through walls from the
fire rooms. Fire rooms themselves are fully involved. A fire room the locator was less sure of seeds a
weaker fire (its candidate confidence relative to the best one).

    field(fp, nav, fire_rooms, conditions)  ->  {"cells", "rooms", "zones", ...}

Danger is 0..1; zones: untenable (>= 0.75, no unprotected entry), high (>= 0.45, crawl, short exposure),
caution (>= 0.2, smoke likely), clear.
"""
import math

import networkx as nx
from shapely.geometry import Point, Polygon
from shapely.prepared import prep

from .navgraph import NavGraph

CELL_M = 0.5
BASE_SPREAD_M = 6.0
WALL_LEAK = 0.45
WALL_LEAK_M = 2.5
GROWTH_PER_MIN = 0.12
ZONES = (("untenable", 0.75), ("high", 0.45), ("caution", 0.2), ("clear", 0.0))
SOURCE = "fire"
# heavier reported fire -> heat and smoke reach further
CONDITION_SPREAD = {"explosion": 1.6, "flames": 1.4, "black smoke": 1.4, "heavy smoke": 1.35,
                    "gray smoke": 1.15, "grey smoke": 1.15, "smoke": 1.1, "white smoke": 1.0}


def zone(v: float) -> str:
    return next(name for name, lo in ZONES if v >= lo)


def spread_for(conditions: list[str] | None, minutes: float = 0.0) -> float:
    mult = max([CONDITION_SPREAD.get(c, 1.0) for c in conditions or []], default=1.0)
    return round(BASE_SPREAD_M * mult * (1 + GROWTH_PER_MIN * max(0.0, minutes)), 1)


def _distances(nav: NavGraph, seeds: dict[str, float], spread: float) -> dict:
    """Walking distance from the fire to every nav node. A seed of strength w starts at -spread*ln(w), so
    exp(-d/spread) at the seed is w. Doors of a fire room are as hot as the room."""
    g = nx.Graph(nav.inside)
    g.add_node(SOURCE)
    for rid, w in seeds.items():
        offset = -spread * math.log(max(w, 1e-3))
        for node in [("room", rid)] + [("door", d["id"]) for d in nav.doors_of(rid)]:
            if not g.has_edge(SOURCE, node) or g[SOURCE][node]["weight"] > offset:
                g.add_edge(SOURCE, node, weight=offset)
    dist = nx.single_source_dijkstra_path_length(g, SOURCE, weight="weight")
    dist.pop(SOURCE, None)
    return dist


def field(fp: dict, nav: NavGraph, fire_rooms: dict[str, float] | list[str], conditions: list[str] | None = None,
          minutes: float = 0.0, cell_m: float = CELL_M) -> dict | None:
    """fire_rooms: room ids, or room id -> strength 0..1. None when no fire room is known."""
    seeds = {r: 1.0 for r in fire_rooms} if isinstance(fire_rooms, list) else dict(fire_rooms)
    seeds = {r: max(0.05, min(1.0, w)) for r, w in seeds.items() if r in nav.rooms}
    if not seeds:
        return None
    spread = spread_for(conditions, minutes)
    dist = _distances(nav, seeds, spread)
    node_pos = {n: nav.g.nodes[n]["pos"] for n in dist}
    by_room: dict[str, list] = {rid: [("room", rid)] + [("door", d["id"]) for d in nav.doors_of(rid)] for rid in nav.rooms}
    fire_polys = [(Polygon(nav.rooms[r]["polygon"]), w) for r, w in seeds.items()]
    rooms = [(rid, prep(s.poly.buffer(0.02)), s.poly.area) for rid, s in nav.spaces.items()]

    def danger_at(xy, rid) -> float:
        if rid in seeds:
            return seeds[rid]
        d = min((dist[n] + math.dist(node_pos[n], xy) for n in by_room[rid] if n in dist), default=math.inf)
        through = math.exp(-d / spread) if d < math.inf else 0.0
        pt = Point(xy)
        leak = max(w * WALL_LEAK * math.exp(-p.distance(pt) / WALL_LEAK_M) for p, w in fire_polys)
        return min(1.0, max(through, leak))

    pts = [p for r in fp["rooms"] for p in r["polygon"]]
    x0, y0 = min(p[0] for p in pts), min(p[1] for p in pts)
    cols = int(math.ceil((max(p[0] for p in pts) - x0) / cell_m))
    rows = int(math.ceil((max(p[1] for p in pts) - y0) / cell_m))
    cells, samples = [], {rid: [] for rid in nav.rooms}
    for j in range(rows):
        row = []
        for i in range(cols):
            xy = (x0 + (i + 0.5) * cell_m, y0 + (j + 0.5) * cell_m)
            pt = Point(xy)
            hits = [(area, rid) for rid, poly, area in rooms if poly.contains(pt)]
            if not hits:
                row.append(None)
                continue
            rid = min(hits)[1]
            v = danger_at(xy, rid)
            samples[rid].append(v)
            row.append(round(v, 2))
        cells.append(row)

    out_rooms = {}
    for rid, r in nav.rooms.items():
        vals = samples[rid] or [danger_at(tuple(r["centroid"]), rid)]
        v = round(sum(vals) / len(vals), 2)
        out_rooms[rid] = {"danger": v, "peak": round(max(vals), 2), "zone": zone(v)}
    zones = {name: sorted((rid for rid, x in out_rooms.items() if x["zone"] == name), key=lambda rid: -out_rooms[rid]["danger"])
             for name, _ in ZONES}
    return {
        "fire_room_ids": list(seeds), "spread_m": spread, "minutes": minutes, "conditions": conditions or [],
        "origin": [round(x0, 3), round(y0, 3)], "cell_m": cell_m, "cols": cols, "rows": rows, "cells": cells,
        "rooms": out_rooms, "zones": zones,
        "thresholds": {name: lo for name, lo in ZONES},
    }


def point_danger(heat: dict | None, xy) -> float:
    """Danger at a floor plan point from the grid (0 outside the grid or with no fire)."""
    if not heat:
        return 0.0
    i = int((xy[0] - heat["origin"][0]) / heat["cell_m"])
    j = int((xy[1] - heat["origin"][1]) / heat["cell_m"])
    if 0 <= j < heat["rows"] and 0 <= i < heat["cols"]:
        return heat["cells"][j][i] or 0.0
    return 0.0
